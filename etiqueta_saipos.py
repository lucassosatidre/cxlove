"""
ETIQUETA SAIPOS -> ELGIN L42PRO FULL
Pizzaria Estrela da Ilha
v13.1 - Header invertido, margem direita ajustada
"""

VERSION = "131"
UPDATE_URL = "https://raw.githubusercontent.com/lucassosatidre/cxlove/main/etiqueta_saipos.py"

import os, sys, json, re, time, subprocess, tempfile, base64, shutil, urllib.parse, urllib.request
from datetime import datetime

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "watchdog"])
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

PASTA_DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")
PASTA_SAIPOS = os.path.join(PASTA_DOWNLOADS, "saipos")
NOME_IMPRESSORA = "ELGIN L42PRO FULL"
LARGURA_MM = 80; ALTURA_MM = 30; DPI = 203
LARGURA_PX = int(LARGURA_MM * DPI / 25.4)  # ~640px
ALTURA_PX = int(ALTURA_MM * DPI / 25.4)    # ~240px
LOG_FILE = os.path.join(PASTA_DOWNLOADS, "etiqueta_saipos_log.txt")
DEBUG_FILE = os.path.join(PASTA_DOWNLOADS, "etiqueta_debug.txt")
processados_arquivos = {}; processados_id_sale = {}; cache_pagamento = {}

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S"); linha = f"[{ts}] {msg}"; print(linha)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f: f.write(linha + "\n")
    except: pass

def debug_save(filename, print_rows):
    try:
        with open(DEBUG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\nARQUIVO: {filename}\nHORA: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'='*60}\n")
            for i, row in enumerate(print_rows):
                limpo = re.sub(r'<[^>]+>', '', row).strip()
                if limpo: f.write(f"  [{i:3d}] {limpo}\n")
            f.write(f"{'='*60}\n\n")
    except: pass

def check_update():
    try:
        req = urllib.request.Request(UPDATE_URL, headers={"Cache-Control": "no-cache"})
        resp = urllib.request.urlopen(req, timeout=5); conteudo = resp.read().decode("utf-8")
        m = re.search(r'^VERSION\s*=\s*["\'](\d+)["\']', conteudo, re.MULTILINE)
        if m:
            remote = int(m.group(1)); local = int(VERSION)
            if remote > local:
                log(f"  UPDATE: v{local} -> v{remote}")
                with open(os.path.abspath(__file__), "w", encoding="utf-8") as f: f.write(conteudo)
                log(f"  Reiniciando..."); os.execv(sys.executable, [sys.executable] + sys.argv)
            else: log(f"  Versao v{VERSION} (ok)")
    except Exception as e: log(f"  Update: {e}")

def limpar_tags(texto):
    return re.sub(r'<[^>]+>', '', texto).strip()

def corrigir_encoding(texto):
    texto = re.sub(r'[Mm]u.?arela', 'Mucarela', texto)
    texto = re.sub(r'[Cc]ala.?resa', 'Calabresa', texto)
    texto = re.sub(r'[Ss]ensa.{0,2}o\b', 'Sensacao', texto)
    texto = re.sub(r'[Cc]ama.{0,2}o\b', 'Camarao', texto)
    texto = re.sub(r'[Cc]amar.o\b', 'Camarao', texto)
    texto = re.sub(r'[Bb]r.coli', 'Brocoli', texto)
    texto = re.sub(r'[Cc]atup.ry', 'Catupiry', texto)
    texto = re.sub(r'[Pp]rest.gio', 'Prestigio', texto)
    texto = re.sub(r'[Rr]equeij.o', 'Requeijao', texto)
    texto = re.sub(r'[Ff]eij.o', 'Feijao', texto)
    texto = re.sub(r'[Gg]uaran.[\s]*[Zz]ero', 'Guarana Zero', texto)
    texto = re.sub(r'[Gg]uaran.\s', 'Guarana ', texto)
    texto = re.sub(r'[Aa].?a[ií]\b', 'Acai', texto)
    texto = re.sub(r'[Mm]aracuj.', 'Maracuja', texto)
    texto = re.sub(r'(\w)[^\w\s]o\b', r'\1ao', texto)
    texto = texto.replace("\ufffd", "").replace("\u25a1", "")
    texto = re.sub(r'\s{2,}', ' ', texto)
    return texto

def limpar_nome(nome):
    nome = re.sub(r"##", "", nome)
    nome = re.sub(r"''+.*?''+", "", nome); nome = re.sub(r"'+", "", nome)
    nome = re.sub(r'""+.*?""+', "", nome); nome = re.sub(r'"+', "", nome)
    nome = re.sub(r'\(Obs[.:].*?\)', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'CASHBACK.*', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'desconto\s+do\s+restaurante.*', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'[)\]}>]+$', '', nome); nome = re.sub(r'\*+', '', nome)
    nome = re.sub(r'\s+', ' ', nome).strip(); nome = nome.strip("'\" .*#,;:")
    nome = corrigir_encoding(nome)
    return nome

def abreviar_sabor(sabor):
    s = corrigir_encoding(sabor.strip())
    s = re.sub(r'\s+COM\s+', ' c/ ', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+com\s+', ' c/ ', s)
    m = re.search(r'\(SEM\s+(\w+)\)', s, re.IGNORECASE)
    if m:
        s = re.sub(r'\(SEM\s+\w+\)', '', s, flags=re.IGNORECASE).strip()
        s += f" s/ {m.group(1).lower()}"
    s = re.sub(r'^[Tt]emx\s+[Pp]izza\s+de\s+', '', s)
    s = s.strip()
    if s: s = s[0].lower() + s[1:]
    return s

ORDINAL = r'\d+.?'
def eh_borda(nome):
    n = nome.lower()
    if "borda de" in n: return True
    if re.match(ORDINAL + r'\s+(pizza\s+)?(temx\s+)?(com\s+)?borda', n, re.IGNORECASE): return True
    if "temx borda" in n: return True
    return False
def eh_sabor_temx(nome):
    n = nome.lower().strip()
    if re.match(r'^temx\s+pizza\s+de\s+', n, re.IGNORECASE):
        resto = re.sub(r'^temx\s+pizza\s+de\s+', '', n, flags=re.IGNORECASE)
        if any(t in resto for t in ["broto", "grande", "gigante"]): return False
        return True
    return False
def eh_sabor_numerado(nome):
    n = nome.strip()
    if re.match(ORDINAL + r'\s+[Pp]izza\s+\d+/\d+', n): return True
    if re.match(ORDINAL + r'\s+[Pp]izza\s+de\s+', n):
        if "borda" not in n.lower(): return True
    return False
def eh_fracao(texto):
    return bool(re.match(r'^-?\s*\d+/\d+\s+', texto.strip()))
def extrair_sabor_fracao(texto):
    m = re.match(r'^-?\s*(\d+)/(\d+)\s+(.+?)(?:\s{2,}[\d,.]+)?$', texto.strip())
    if m:
        num = int(m.group(1)); den = int(m.group(2))
        sabor = abreviar_sabor(m.group(3).strip())
        return num, den, sabor
    return None, None, ""
def eh_caixa_pizza(nome):
    n = nome.lower().strip()
    if eh_borda(nome): return False
    if eh_sabor_temx(nome): return False
    if eh_sabor_numerado(nome): return False
    palavras = ["pizza gigante", "pizza grande", "pizza broto",
                "gigante", "grande", "broto", "brotinho",
                "temx pizza gigante", "temx pizza grande", "temx pizza broto"]
    for p in palavras:
        if p in n: return True
    return False
def eh_bebida(nome):
    n = nome.lower().strip()
    palavras = ["coca", "pepsi", "guarana", "pureza", "refrigerante",
                "suco", "agua", "cerveja", "heineken", "skol", "vinho", "espumante"]
    for p in palavras:
        if p in n: return True
    return False
def contar_pizzas_no_nome(nome):
    m = re.match(r'^(\d+)\s*x\s+', nome, re.IGNORECASE)
    return int(m.group(1)) if m else 1
def nome_sem_combo(nome):
    nome = re.sub(r'^\d+\s*x\s+', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'\s*\+\s*(refrigerante|coca.*|pureza.*|refri.*)$', '', nome, flags=re.IGNORECASE)
    return nome.strip()
def nome_borda_curto(nome):
    m = re.search(r'[Bb]orda\s+de\s+(.+)', nome)
    return corrigir_encoding(m.group(1).strip()) if m else corrigir_encoding(nome)
def eh_elemento_cozinha(elemento):
    ps = elemento.get("printSettings", {})
    if ps.get("type") == 1: return True
    rows = elemento.get("printRows", [])
    for row in rows:
        if re.search(r'#\d+\s*-\s*\d+/\d+', limpar_tags(row)): return True
    return False
def ler_arquivo_saipos(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f: conteudo = f.read().strip()
        if conteudo.startswith("{") or conteudo.startswith("["): return json.loads(conteudo)
        try:
            padded = conteudo + "=" * (4 - len(conteudo) % 4)
            decoded = base64.b64decode(padded).decode("utf-8", errors="replace")
            if decoded.startswith("{") or decoded.startswith("["): return json.loads(decoded)
        except: pass
        try:
            url_decoded = urllib.parse.unquote(conteudo)
            padded = url_decoded + "=" * (4 - len(url_decoded) % 4)
            decoded = base64.b64decode(padded).decode("utf-8", errors="replace")
            if decoded.startswith("{") or decoded.startswith("["): return json.loads(decoded)
        except: pass
        return None
    except: return None

def consolidar_sabores(sabores_raw):
    if not sabores_raw: return []
    grupos = {}; ordem = []
    for num, den, nome in sabores_raw:
        key = (den, nome)
        if key not in grupos: grupos[key] = 0; ordem.append(key)
        grupos[key] += num
    resultado = []
    for den, nome in ordem:
        total_num = grupos[(den, nome)]
        if den == 2:
            for _ in range(total_num): resultado.append(f"1/2 {nome}")
        else:
            resultado.append(f"{total_num}/{den} {nome}")
    return resultado

def extrair_itens_printrows(print_rows):
    display = []; total_caixas = 0; total_bebidas = 0; total_outros = 0
    em_zona = False; ultimo_tipo = None
    for row in print_rows:
        texto = limpar_tags(row)
        if "Qt.Descri" in texto: em_zona = True; continue
        if "Quantidade de itens" in texto: em_zona = False; continue
        if not em_zona: continue
        if not texto or texto == " ": continue
        texto_limpo = texto.strip()

        mp = re.match(r'^(\d+)\s{2,}(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if mp:
            qty = int(mp.group(1)); nome_raw = limpar_nome(mp.group(2).strip())
            ultimo_tipo = "item"
            if eh_borda(nome_raw): display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif eh_caixa_pizza(nome_raw):
                mult = contar_pizzas_no_nome(nome_raw)
                display.append({"tipo": "caixa", "nome": nome_sem_combo(nome_raw), "qty": qty*mult, "sabores_raw": []})
                total_caixas += qty*mult
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_bebidas += qty
            elif nome_raw:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_outros += qty
            continue
        ms = re.match(r'^-\s*(\d+)x\s+(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if ms:
            qty = int(ms.group(1)); nome_raw = limpar_nome(ms.group(2).strip())
            ultimo_tipo = "item"
            if eh_borda(nome_raw): display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_caixa_pizza(nome_raw):
                display.append({"tipo": "caixa", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_caixas += qty
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_bebidas += qty
            elif nome_raw:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_outros += qty
            continue
        if eh_fracao(texto_limpo):
            num, den, sabor = extrair_sabor_fracao(texto_limpo)
            if sabor and num and den:
                for d in reversed(display):
                    if d["tipo"] == "caixa": d["sabores_raw"].append((num, den, sabor)); break
            ultimo_tipo = "sabor"; continue
        ms2 = re.match(r'^-\s*(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if ms2:
            nome_raw = limpar_nome(ms2.group(1).strip())
            ultimo_tipo = "item"
            if eh_borda(nome_raw): display.append({"tipo": "borda", "nome": nome_raw, "qty": 1, "sabores_raw": []})
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_caixa_pizza(nome_raw):
                display.append({"tipo": "caixa", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_caixas += 1
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_bebidas += 1
            elif nome_raw and len(nome_raw) > 2:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_outros += 1
            continue
        if texto_limpo and len(texto_limpo) <= 25 and not texto_limpo.startswith("-"):
            texto_enc = corrigir_encoding(texto_limpo)
            if ultimo_tipo == "sabor" and display:
                for d in reversed(display):
                    if d["tipo"] == "caixa" and d["sabores_raw"]:
                        n, de, sab = d["sabores_raw"][-1]
                        d["sabores_raw"][-1] = (n, de, (sab + " " + texto_enc.lower()).strip()); break
            elif display:
                display[-1]["nome"] = limpar_nome(display[-1]["nome"] + texto_limpo)
    for d in display: d["sabores"] = consolidar_sabores(d.get("sabores_raw", []))
    return display, total_caixas, total_bebidas, total_outros

def extrair_numero_pedido(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'#(\d+)', texto)
        if m: return m.group(1)
        m2 = re.search(r'Pedido:\s*(\d+)', texto)
        if m2: return m2.group(1)
    return ""
def extrair_codigo_canal(print_rows):
    codigo = ""; canal = ""
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'(iFood|Brendi)\s*:\s*n.{0,3}:\s*(\d{3,5})', texto, re.IGNORECASE)
        if m: canal = m.group(1); codigo = m.group(2); continue
        m2 = re.search(r'C.?d\.?\s*no canal:\s*(\d{3,5})', texto)
        if m2: codigo = m2.group(1); continue
        m3 = re.search(r'Nome do canal:\s*(iFood|Brendi)', texto, re.IGNORECASE)
        if m3: canal = m3.group(1); continue
    return canal, codigo
def extrair_nome_cliente(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'Nome do cliente:\s*(.+)', texto)
        if m:
            partes = m.group(1).strip().split()
            if partes: return partes[0].upper()
    return ""
def extrair_hora_pedido(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'Data/hora:\s*\S+\s*-\s*(\d{1,2}:\d{2})', texto)
        if m: return m.group(1)
    return ""

def extrair_valor_linha(linha):
    m = re.search(r'([\d]+[.,][\d]{2})\s*$', linha.strip())
    if m:
        val = m.group(1).replace(".", "").replace(",", ".")
        try: return float(val)
        except: pass
    return 0.0

def extrair_pagamento(print_rows):
    todas_linhas = []
    for row in print_rows:
        texto = limpar_tags(row)
        if texto: todas_linhas.append(texto)
    texto_lower = " ".join(l.lower() for l in todas_linhas)
    pagamento = ""; valor = ""; troco = ""
    if "cobrar do cliente" in texto_lower:
        em_cobranca = False; valor_total = 0.0
        tem_dinheiro = False; tem_troco = False; valor_troco = 0.0; valor_receber = 0.0; detalhes = []
        for linha in todas_linhas:
            ll = linha.lower().strip()
            if "cobrar do cliente" in ll: em_cobranca = True; continue
            if not em_cobranca: continue
            if re.match(r'^(ifood|brendi|pizzaria|data|id da venda|op:|www|n.?\s*pedido)', ll): break
            val = extrair_valor_linha(linha)
            if val <= 0: continue
            if ll.startswith("total"): continue
            if re.search(r'[Dd]inheiro', linha): tem_dinheiro = True; valor_total += val; detalhes.append("din"); continue
            if re.search(r'[Rr]eceber', linha): valor_receber = val; continue
            if re.search(r'[Tt]roco', linha): tem_troco = True; valor_troco = val; continue
            if re.search(r'[Dd].?bito', linha): valor_total += val; detalhes.append("deb"); continue
            if re.search(r'[Cc]r.?dito', linha): valor_total += val; detalhes.append("cred"); continue
            if re.search(r'[Pp]ix', linha): valor_total += val; detalhes.append("pix"); continue
            if re.search(r'[Vv]oucher', linha): valor_total += val; detalhes.append("voucher"); continue
        if tem_dinheiro and tem_troco:
            pagamento = "TROCO"
            try: valor = f"{valor_receber:.2f}".replace(".",",") if valor_receber > 0 else f"{valor_total:.2f}".replace(".",",")
            except: pass
            try: troco = f"{valor_troco:.2f}".replace(".",",")
            except: pass
        elif tem_dinheiro and len(detalhes) > 1:
            pagamento = "MISTO"; valor = f"{valor_total:.2f}".replace(".",",")
        elif tem_dinheiro:
            pagamento = "DINHEIRO"; valor = f"{valor_total:.2f}".replace(".",",")
        else:
            pagamento = "CARTAO"; valor = f"{valor_total:.2f}".replace(".",",")
        return pagamento, valor, troco
    if "(pago)" in texto_lower or "pago online" in texto_lower or "pago pelo cliente" in texto_lower:
        return "PAGO", "", ""
    if "dinheiro" in texto_lower:
        pagamento = "DINHEIRO"
        for linha in todas_linhas:
            m = re.search(r'[Dd]inheiro\s+([\d.,]+)', linha)
            if m: val = m.group(1).replace(".",  "").replace(",","."); valor = f"{float(val):.2f}".replace(".",",")
        if "troco" in texto_lower:
            pagamento = "TROCO"
            for linha in todas_linhas:
                m = re.search(r'[Rr]eceber\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m: val = m.group(1).replace(".","").replace(",","."); valor = f"{float(val):.2f}".replace(".",",")
            for linha in todas_linhas:
                m = re.search(r'[Tt]roco\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m: val = m.group(1).replace(".","").replace(",","."); troco = f"{float(val):.2f}".replace(".",",")
        return pagamento, valor, troco
    if "forma de pagamento" in texto_lower: return "CARTAO", "", ""
    return pagamento, valor, troco

def eh_retirada(print_rows):
    for row in print_rows:
        texto = limpar_tags(row).lower()
        if "retirada" in texto or "balc" in texto: return True
    return False

def agrupar_display(display):
    resultado = []; i = 0
    while i < len(display):
        item = display[i]
        if item["tipo"] == "borda": resultado.append(dict(item)); i += 1; continue
        if item["tipo"] == "caixa": resultado.append(dict(item)); i += 1; continue
        nome = item["nome"]; qty_total = item["qty"]; j = i + 1
        while j < len(display) and display[j]["nome"] == nome and display[j]["tipo"] == item["tipo"]:
            qty_total += display[j]["qty"]; j += 1
        resultado.append({"tipo": item["tipo"], "nome": nome, "qty": qty_total, "sabores": item.get("sabores",[])}); i = j
    return resultado

def word_wrap(texto, draw, font, max_w):
    palavras = texto.split(); linhas = []; linha_atual = ""
    for palavra in palavras:
        teste = f"{linha_atual} {palavra}".strip() if linha_atual else palavra
        try: bb = draw.textbbox((0,0), teste, font=font); tw = bb[2]-bb[0]
        except: tw = len(teste)*10
        if tw <= max_w: linha_atual = teste
        else:
            if linha_atual: linhas.append(linha_atual)
            linha_atual = palavra
    if linha_atual: linhas.append(linha_atual)
    return linhas if linhas else [texto]


def gerar_etiqueta(numero_pedido, pizza_num, total_pizzas, display_items, total_entrega,
                   pagamento, valor, troco, balcao, canal, codigo_canal, nome_cliente, hora_pedido):
    img = Image.new("RGB", (LARGURA_PX, ALTURA_PX), "white")
    draw = ImageDraw.Draw(img)
    margem_e = 16; margem_d = 28; max_w = LARGURA_PX - margem_e - margem_d

    def cf(tamanho):
        try: return ImageFont.truetype("arialbd.ttf", tamanho)
        except:
            try: return ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", tamanho)
            except: return ImageFont.load_default()

    # ============================================================
    # HEADER: fundo preto, texto branco (laranja no BOPP)
    # ============================================================
    h_bar = 52

    # Fundo preto
    draw.rectangle([(0, 0), (LARGURA_PX, h_bar)], fill="black")

    # Texto principal: #91  -  1/2
    font_h = cf(42)
    txt_main = f"#{numero_pedido}  -  {pizza_num}/{total_pizzas}"
    draw.text((margem_e+2, 4), txt_main, fill="white", font=font_h)
    try:
        bb = draw.textbbox((0,0), txt_main, font=font_h)
        w_main = bb[2]-bb[0]
    except: w_main = 300

    # Info extra direita: -  3016  -  21:49
    partes_extra = []
    if balcao and nome_cliente:
        partes_extra.append(f"{nome_cliente} BALCAO")
    elif balcao:
        partes_extra.append("BALCAO")
    elif codigo_canal:
        partes_extra.append(codigo_canal)
    if hora_pedido:
        partes_extra.append(hora_pedido)
    extra_txt = "  -  ".join(partes_extra)
    if extra_txt:
        extra_txt = "-  " + extra_txt

    font_e = cf(22)
    # Auto-fit
    for sz in [22, 20, 18, 16, 14]:
        font_e = cf(sz)
        try:
            bb_e = draw.textbbox((0,0), extra_txt, font=font_e)
            if w_main + 12 + (bb_e[2]-bb_e[0]) <= max_w: break
        except: pass

    if extra_txt:
        try:
            bb_e = draw.textbbox((0,0), extra_txt, font=font_e)
            ye = h_bar//2 - (bb_e[3]-bb_e[1])//2
        except: ye = 14
        draw.text((LARGURA_PX - margem_d - 4 - (bb_e[2]-bb_e[0]), ye), extra_txt, fill="white", font=font_e)

    # ============================================================
    # CONTEUDO: 2 colunas ou 1 coluna
    # ============================================================
    y_content = h_bar + 4
    footer_h = 22
    content_h = ALTURA_PX - h_bar - footer_h - 4
    col_w = (LARGURA_PX - margem_e - margem_d) // 2
    mid_x = margem_e + col_w

    # Montar linhas para coluna esquerda e direita
    linhas_esq = []; linhas_dir = []
    for item in display_items:
        if item["tipo"] == "borda":
            linhas_esq.append(("borda", f"Borda: {nome_borda_curto(item['nome'])}"))
        elif item["tipo"] == "caixa":
            sabores = item.get("sabores", [])
            if sabores:
                linhas_esq.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: linhas_esq.append(("sabores", f"  {s}"))
            else:
                linhas_esq.append(("item", f"{item['qty']}x {item['nome']}"))
        else:
            # Bebidas e outros vao pra direita
            linhas_dir.append(("item", f"{item['qty']}x {item['nome']}"))

    # Se nao tem coluna direita, usar coluna unica
    usar_2col = len(linhas_dir) > 0

    # Calcular font sizes
    max_linhas = max(len(linhas_esq), len(linhas_dir)) if usar_2col else len(linhas_esq)
    if max_linhas > 0:
        lh_est = content_h / max_linhas
        font_size = min(int(lh_est * 0.75), 18); font_size = max(font_size, 9)
    else:
        font_size = 16

    font_item = cf(font_size)
    font_sab = cf(max(font_size - 2, 9))
    font_borda = cf(max(font_size - 3, 9))

    col_max_w = col_w - 10 if usar_2col else max_w

    # Word wrap
    def wrap_linhas(linhas_raw, mw):
        resultado = []
        for tipo, txt in linhas_raw:
            fu = font_item if tipo == "item" else (font_borda if tipo == "borda" else font_sab)
            wrapped = word_wrap(txt, draw, fu, mw)
            for wl in wrapped: resultado.append((tipo, wl))
        return resultado

    linhas_esq_f = wrap_linhas(linhas_esq, col_max_w)
    linhas_dir_f = wrap_linhas(linhas_dir, col_max_w) if usar_2col else []

    # Recalcular se muitas linhas apos wrap
    max_linhas_f = max(len(linhas_esq_f), len(linhas_dir_f)) if usar_2col else len(linhas_esq_f)
    if max_linhas_f > 0:
        lh_est = content_h / max_linhas_f
        font_size_new = min(int(lh_est * 0.75), 18); font_size_new = max(font_size_new, 8)
        if font_size_new < font_size - 2:
            font_size = font_size_new
            font_item = cf(font_size); font_sab = cf(max(font_size-2,8)); font_borda = cf(max(font_size-3,8))
            linhas_esq_f = wrap_linhas(linhas_esq, col_max_w)
            linhas_dir_f = wrap_linhas(linhas_dir, col_max_w) if usar_2col else []
            max_linhas_f = max(len(linhas_esq_f), len(linhas_dir_f)) if usar_2col else len(linhas_esq_f)

    lh = content_h / max(max_linhas_f, 1)

    # Divisoria pontilhada
    if usar_2col:
        for dy in range(0, content_h, 6):
            draw.line([(mid_x, y_content+dy), (mid_x, y_content+dy+3)], fill="black", width=1)

    # Coluna esquerda
    y = y_content + 2
    for tipo, txt in linhas_esq_f:
        fu = font_item if tipo == "item" else (font_borda if tipo == "borda" else font_sab)
        draw.text((margem_e, y), txt, fill="black", font=fu)
        y += lh

    # Coluna direita
    if usar_2col:
        y = y_content + 2
        for tipo, txt in linhas_dir_f:
            fu = font_item if tipo == "item" else (font_borda if tipo == "borda" else font_sab)
            draw.text((mid_x + 6, y), txt, fill="black", font=fu)
            y += lh

    # ============================================================
    # FOOTER
    # ============================================================
    footer_y = ALTURA_PX - footer_h
    draw.line([(margem_e, footer_y), (LARGURA_PX-margem_d, footer_y)], fill="black", width=2)

    footer_parts = [f"Itens: {total_entrega}"]
    if pagamento == "PAGO": footer_parts.append("PAGO")
    elif pagamento == "TROCO":
        txt = f"TROCO R${valor}" if valor else "TROCO"
        if troco: txt += f" (troco R${troco})"
        footer_parts.append(txt)
    elif pagamento == "DINHEIRO": footer_parts.append(f"DINHEIRO R${valor}" if valor else "DINHEIRO")
    elif pagamento == "CARTAO": footer_parts.append(f"CARTAO R${valor}" if valor else "CARTAO")
    elif pagamento == "MISTO": footer_parts.append(f"MISTO R${valor}" if valor else "MISTO")
    footer_texto = "  |  ".join(footer_parts)

    font_footer = cf(max(font_size, 12))
    try:
        bb_f = draw.textbbox((0,0), footer_texto, font=font_footer)
        if (bb_f[2]-bb_f[0]) > max_w: font_footer = cf(max(font_size-2, 9))
    except: pass
    draw.text((margem_e, footer_y + 4), footer_texto, fill="black", font=font_footer)

    return img


def imprimir_etiqueta(img):
    tmp = tempfile.NamedTemporaryFile(suffix=".bmp", delete=False); tmp_path = tmp.name; tmp.close()
    try:
        img.save(tmp_path, "BMP")
        try:
            import win32print, win32ui; from PIL import ImageWin
            hdc = win32ui.CreateDC(); hdc.CreatePrinterDC(NOME_IMPRESSORA)
            hdc.StartDoc("Etiqueta Saipos"); hdc.StartPage()
            ImageWin.Dib(img).draw(hdc.GetHandleOutput(), (0, 0, LARGURA_PX, ALTURA_PX))
            hdc.EndPage(); hdc.EndDoc(); hdc.DeleteDC(); log("  Impresso OK")
        except ImportError:
            subprocess.run(f'mspaint /pt "{tmp_path}" "{NOME_IMPRESSORA}"', shell=True, capture_output=True, timeout=10)
            log("  Impresso OK (mspaint)")
    except Exception as e: log(f"  ERRO: {e}")
    finally:
        try: time.sleep(2); os.unlink(tmp_path)
        except: pass

def processar_nfce(filepath, filename):
    data = ler_arquivo_saipos(filepath)
    if not data: return
    if isinstance(data, dict): data = [data]
    for el in data:
        rows = el.get("printRows", []); debug_save(filename, rows)
        id_sale = str(el.get("id_sale", ""))
        if not id_sale:
            for row in rows:
                m = re.search(r'ID:\s*(\d+)', limpar_tags(row))
                if m: id_sale = m.group(1); break
        pag, val, trc = extrair_pagamento(rows); bal = eh_retirada(rows)
        cn, cd = extrair_codigo_canal(rows); nc = extrair_nome_cliente(rows); hr = extrair_hora_pedido(rows)
        if id_sale and (pag or cd):
            cache_pagamento[id_sale] = {"pagamento":pag,"valor":val,"troco":trc,"balcao":bal,
                                        "canal":cn,"codigo_canal":cd,"nome_cliente":nc,"hora":hr}
            log(f"  NFCe: {id_sale} -> {pag} {val} canal={cd}")
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
    except: pass

def processar_pedido(filepath, filename):
    data = ler_arquivo_saipos(filepath)
    if not data: log(f"  Parse falhou"); return
    if isinstance(data, dict): data = [data]
    id_sale = ""
    for el in data:
        s = str(el.get("id_sale", "")); 
        if s: id_sale = s; break
    if id_sale and id_sale in processados_id_sale:
        elapsed = time.time() - processados_id_sale[id_sale]
        if elapsed < 30:
            log(f"  Dedup: {id_sale} ({elapsed:.0f}s atras)")
            try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
            except: pass
            return
        else:
            log(f"  Reimpressao: {id_sale} ({elapsed:.0f}s atras)")

    el_cozinha = []; el_caixa = []
    for el in data:
        rows = el.get("printRows", []); debug_save(filename, rows)
        if eh_elemento_cozinha(el): el_cozinha.append(el)
        else: el_caixa.append(el)
    log(f"  {len(el_cozinha)} cozinha, {len(el_caixa)} caixa")

    pagamento=""; valor=""; troco=""; balcao=False; canal=""; codigo_canal=""; nome_cliente=""; hora_pedido=""
    for el in el_caixa:
        rows = el.get("printRows", [])
        p,v,t = extrair_pagamento(rows)
        if p: pagamento=p; valor=v; troco=t
        if eh_retirada(rows): balcao=True
        c,cd = extrair_codigo_canal(rows)
        if cd: canal=c; codigo_canal=cd
        nc = extrair_nome_cliente(rows)
        if nc: nome_cliente=nc
        hr = extrair_hora_pedido(rows)
        if hr: hora_pedido=hr

    if not pagamento:
        for el in el_cozinha:
            rows=el.get("printRows",[]); p,v,t=extrair_pagamento(rows)
            if p: pagamento=p; valor=v; troco=t
            if eh_retirada(rows): balcao=True
    if not codigo_canal:
        for el in el_cozinha:
            c,cd = extrair_codigo_canal(el.get("printRows",[]));
            if cd: canal=c; codigo_canal=cd
    if not nome_cliente:
        for el in el_cozinha:
            nc=extrair_nome_cliente(el.get("printRows",[]));
            if nc: nome_cliente=nc
    if not hora_pedido:
        for el in el_cozinha:
            hr=extrair_hora_pedido(el.get("printRows",[]));
            if hr: hora_pedido=hr
    for el in el_cozinha:
        if eh_retirada(el.get("printRows",[])): balcao=True

    if not pagamento or not codigo_canal:
        if id_sale and id_sale in cache_pagamento:
            cached=cache_pagamento[id_sale]
            if not pagamento: pagamento=cached.get("pagamento",""); valor=cached.get("valor",""); troco=cached.get("troco","")
            balcao=balcao or cached.get("balcao",False)
            if not codigo_canal: codigo_canal=cached.get("codigo_canal",""); canal=cached.get("canal","")
            if not nome_cliente: nome_cliente=cached.get("nome_cliente","")
            if not hora_pedido: hora_pedido=cached.get("hora","")
            log(f"  Cache: {pagamento} canal={codigo_canal}")
        else:
            log(f"  Aguardando NFCe (5s)..."); time.sleep(5)
            if id_sale and id_sale in cache_pagamento:
                cached=cache_pagamento[id_sale]
                if not pagamento: pagamento=cached.get("pagamento",""); valor=cached.get("valor",""); troco=cached.get("troco","")
                balcao=balcao or cached.get("balcao",False)
                if not codigo_canal: codigo_canal=cached.get("codigo_canal",""); canal=cached.get("canal","")
                if not nome_cliente: nome_cliente=cached.get("nome_cliente","")
                if not hora_pedido: hora_pedido=cached.get("hora","")
                log(f"  Cache NFCe: {pagamento} canal={codigo_canal}")

    if id_sale: processados_id_sale[id_sale] = time.time()

    # ITENS do CAIXA (fonte principal)
    el_itens = el_caixa if el_caixa else el_cozinha
    all_display=[]; numero_pedido=""
    for el in el_itens:
        rows=el.get("printRows",[]); num=extrair_numero_pedido(rows)
        if num: numero_pedido=num
        display,cx,bb,ou = extrair_itens_printrows(rows); all_display.extend(display)
    if not numero_pedido:
        for el in (el_cozinha if el_caixa else el_caixa):
            num=extrair_numero_pedido(el.get("printRows",[]));
            if num: numero_pedido=num; break

    all_display=agrupar_display(all_display)
    total_caixas=sum(d["qty"] for d in all_display if d["tipo"]=="caixa")
    total_bebidas=sum(d["qty"] for d in all_display if d["tipo"]=="bebida")
    total_outros=sum(d["qty"] for d in all_display if d["tipo"]=="outro")
    total_entrega=total_caixas+total_bebidas+total_outros

    log(f"  #{numero_pedido}: {total_caixas}cx {total_bebidas}beb {total_outros}out = {total_entrega} | {pagamento} R${valor} | canal={codigo_canal} | {'BALCAO' if balcao else 'ENTREGA'} | {nome_cliente} | {hora_pedido}")

    if total_caixas==0 and total_entrega==0:
        log(f"  Sem itens")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return

    num_etiquetas=max(total_caixas,1)
    for i in range(1, num_etiquetas+1):
        img=gerar_etiqueta(numero_pedido, i, num_etiquetas, all_display, total_entrega,
                           pagamento, valor, troco, balcao, canal, codigo_canal, nome_cliente, hora_pedido)
        log(f"  Etiqueta {i}/{num_etiquetas}..."); imprimir_etiqueta(img)
        if i < num_etiquetas: time.sleep(0.5)
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log(f"  Movido")
    except: pass
    log(f"  OK #{numero_pedido} - {num_etiquetas} etiqueta(s)!")

def processar_arquivo(filepath):
    filename=os.path.basename(filepath)
    if filename in processados_arquivos and (time.time() - processados_arquivos[filename]) < 30: return
    processados_arquivos[filename] = time.time(); log(f"Arquivo: {filename}")
    if filename.lower().startswith("nfce_"): processar_nfce(filepath, filename); return
    processar_pedido(filepath, filename)

class SaiposHandler(FileSystemEventHandler):
    def on_created(self, event): self._processar(event.src_path)
    def on_moved(self, event): self._processar(event.dest_path)
    def _processar(self, filepath):
        if os.path.isdir(filepath): return
        fn=os.path.basename(filepath).lower()
        if fn.endswith(".saiposprt") or fn.endswith(".saiposnfeprt"):
            time.sleep(1)
            try: processar_arquivo(filepath)
            except Exception as e: log(f"ERRO: {fn}: {e}")

def main():
    print("="*60)
    print(f"  ETIQUETA SAIPOS -> ELGIN L42PRO FULL  (v{VERSION})")
    print("  Pizzaria Estrela da Ilha - BOPP 80x30mm")
    print("="*60+"\n")
    print(f"  Usuario:     {os.path.expanduser('~')}")
    print(f"  Monitorando: {PASTA_DOWNLOADS}")
    print(f"  Impressora:  {NOME_IMPRESSORA}")
    print(f"  Etiqueta:    {LARGURA_MM}x{ALTURA_MM}mm\n")
    print("  Verificando atualizacoes..."); check_update(); print()
    if not os.path.exists(PASTA_DOWNLOADS):
        print(f"  ERRO: Pasta nao encontrada: {PASTA_DOWNLOADS}"); input("  Enter para sair..."); return
    os.makedirs(PASTA_SAIPOS, exist_ok=True)
    print("  Aguardando pedidos do Saipos...\n  (Ctrl+C para parar)\n")
    log(f"Script v{VERSION} iniciado - {LARGURA_MM}x{ALTURA_MM}mm")
    handler=SaiposHandler(); observer=Observer()
    observer.schedule(handler, PASTA_DOWNLOADS, recursive=False); observer.start()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt: log("Script encerrado"); observer.stop()
    observer.join()

if __name__=="__main__": main()
