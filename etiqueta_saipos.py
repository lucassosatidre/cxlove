"""
ETIQUETA SAIPOS -> ELGIN L42PRO FULL
Pizzaria Estrela da Ilha
v14.2 - Destaque ITENS+pagamento com fundo preto (aparece laranja no BOPP)
"""

VERSION = "142"
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
LARGURA_PX = int(LARGURA_MM * DPI / 25.4)
ALTURA_PX = int(ALTURA_MM * DPI / 25.4)
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
        import ssl
        # Contexto SSL permissivo (resolve erros de certificado em Windows antigo)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(UPDATE_URL, headers={"Cache-Control": "no-cache"})
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        conteudo = resp.read().decode("utf-8")
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
def eh_pizza_salgada(nome):
    """Pizza salgada: gigante, grande (nao broto/doce)"""
    n = nome.lower().strip()
    if eh_borda(nome): return False
    if eh_sabor_temx(nome): return False
    if eh_sabor_numerado(nome): return False
    if "broto" in n or "brotinho" in n: return False
    palavras = ["pizza gigante", "pizza grande", "gigante", "grande",
                "temx pizza gigante", "temx pizza grande"]
    for p in palavras:
        if p in n: return True
    return False
def eh_pizza_broto(nome):
    """Pizza broto/doce: sempre vai pra direita"""
    n = nome.lower().strip()
    if eh_borda(nome): return False
    if eh_sabor_temx(nome): return False
    if eh_sabor_numerado(nome): return False
    if "broto" in n or "brotinho" in n: return True
    return False
def eh_caixa_pizza(nome):
    """Qualquer pizza que vira caixa (conta como etiqueta)"""
    return eh_pizza_salgada(nome) or eh_pizza_broto(nome)
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
            if eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif eh_pizza_salgada(nome_raw):
                mult = contar_pizzas_no_nome(nome_raw)
                display.append({"tipo": "caixa_salgada", "nome": nome_sem_combo(nome_raw), "qty": qty*mult, "sabores_raw": []})
                total_caixas += qty*mult
            elif eh_pizza_broto(nome_raw):
                mult = contar_pizzas_no_nome(nome_raw)
                display.append({"tipo": "caixa_doce", "nome": nome_sem_combo(nome_raw), "qty": qty*mult, "sabores_raw": []})
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
            if eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_pizza_salgada(nome_raw):
                display.append({"tipo": "caixa_salgada", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_caixas += qty
            elif eh_pizza_broto(nome_raw):
                display.append({"tipo": "caixa_doce", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_caixas += qty
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_bebidas += qty
            elif nome_raw:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_outros += qty
            continue
        if eh_fracao(texto_limpo):
            num, den, sabor = extrair_sabor_fracao(texto_limpo)
            if sabor and num and den:
                for d in reversed(display):
                    if d["tipo"] in ("caixa_salgada", "caixa_doce"):
                        d["sabores_raw"].append((num, den, sabor)); break
            ultimo_tipo = "sabor"; continue
        ms2 = re.match(r'^-\s*(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if ms2:
            nome_raw = limpar_nome(ms2.group(1).strip())
            ultimo_tipo = "item"
            if eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": 1, "sabores_raw": []})
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_pizza_salgada(nome_raw):
                display.append({"tipo": "caixa_salgada", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_caixas += 1
            elif eh_pizza_broto(nome_raw):
                display.append({"tipo": "caixa_doce", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_caixas += 1
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_bebidas += 1
            elif nome_raw and len(nome_raw) > 2:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_outros += 1
            continue
        if texto_limpo and len(texto_limpo) <= 25 and not texto_limpo.startswith("-"):
            texto_enc = corrigir_encoding(texto_limpo)
            if ultimo_tipo == "sabor" and display:
                for d in reversed(display):
                    if d["tipo"] in ("caixa_salgada", "caixa_doce") and d["sabores_raw"]:
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
    """
    Retorna tupla (categoria, dados)
    categoria: PAGO, MAQUINONA, DINHEIRO, DINHEIRO_TROCO, DIN_MAQUINONA
    dados: dict com valor, valor_pedido, valor_receber, valor_troco conforme categoria
    """
    todas_linhas = []
    for row in print_rows:
        texto = limpar_tags(row)
        if texto: todas_linhas.append(texto)
    texto_lower = " ".join(l.lower() for l in todas_linhas)

    # PRIORIDADE 1: COBRAR DO CLIENTE
    if "cobrar do cliente" in texto_lower:
        em_cobranca = False
        val_dinheiro = 0.0; val_maquinona = 0.0
        val_receber = 0.0; val_troco = 0.0
        tem_dinheiro = False; tem_troco = False; tem_maquinona = False

        for linha in todas_linhas:
            ll = linha.lower().strip()
            if "cobrar do cliente" in ll: em_cobranca = True; continue
            if not em_cobranca: continue
            if re.match(r'^(ifood|brendi|pizzaria|data|id da venda|op:|www|n.?\s*pedido)', ll): break
            val = extrair_valor_linha(linha)
            if ll.startswith("total"): continue

            if re.search(r'[Rr]eceber', linha) and val > 0:
                val_receber = val; continue
            if re.search(r'[Tt]roco', linha) and val > 0:
                tem_troco = True; val_troco = val; continue
            if val <= 0: continue

            if re.search(r'[Dd]inheiro', linha):
                tem_dinheiro = True; val_dinheiro += val; continue
            if re.search(r'[Dd].?bito', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Cc]r.?dito', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Pp]ix', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Vv]oucher', linha):
                tem_maquinona = True; val_maquinona += val; continue

        # Classificar
        if tem_dinheiro and tem_maquinona:
            total = val_dinheiro + val_maquinona
            return "DIN_MAQUINONA", {"valor": total}
        if tem_dinheiro and tem_troco:
            return "DINHEIRO_TROCO", {
                "valor_pedido": val_dinheiro,
                "valor_receber": val_receber if val_receber > 0 else val_dinheiro,
                "valor_troco": val_troco
            }
        if tem_dinheiro:
            return "DINHEIRO", {"valor": val_dinheiro}
        if tem_maquinona:
            return "MAQUINONA", {"valor": val_maquinona}

    # PRIORIDADE 2: Pago online
    if "(pago)" in texto_lower or "pago online" in texto_lower or "pago pelo cliente" in texto_lower:
        return "PAGO", {}

    # PRIORIDADE 3: Dinheiro direto
    if "dinheiro" in texto_lower:
        val_dinheiro = 0.0
        for linha in todas_linhas:
            m = re.search(r'[Dd]inheiro\s+([\d.,]+)', linha)
            if m:
                val = m.group(1).replace(".", "").replace(",", ".")
                try: val_dinheiro = float(val)
                except: pass
        if "troco" in texto_lower:
            val_receber = 0.0; val_troco = 0.0
            for linha in todas_linhas:
                m = re.search(r'[Rr]eceber\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m:
                    v = m.group(1).replace(".", "").replace(",", ".")
                    try: val_receber = float(v)
                    except: pass
            for linha in todas_linhas:
                m = re.search(r'[Tt]roco\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m:
                    v = m.group(1).replace(".", "").replace(",", ".")
                    try: val_troco = float(v)
                    except: pass
            return "DINHEIRO_TROCO", {
                "valor_pedido": val_dinheiro,
                "valor_receber": val_receber if val_receber > 0 else val_dinheiro,
                "valor_troco": val_troco
            }
        return "DINHEIRO", {"valor": val_dinheiro}

    if "forma de pagamento" in texto_lower:
        return "MAQUINONA", {"valor": 0.0}

    return "", {}

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
        if item["tipo"] in ("caixa_salgada", "caixa_doce"):
            resultado.append(dict(item)); i += 1; continue
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

def formatar_valor(v):
    """Float -> string R$XX,XX"""
    try: return f"{v:.2f}".replace(".", ",")
    except: return "0,00"

def montar_linhas_pagamento(pag_cat, pag_dados):
    """Retorna lista de linhas de pagamento a exibir no lado direito"""
    linhas = []
    if pag_cat == "PAGO":
        linhas.append("PAGO")
    elif pag_cat == "MAQUINONA":
        v = pag_dados.get("valor", 0)
        linhas.append(f"MAQUINONA: R${formatar_valor(v)}")
    elif pag_cat == "DINHEIRO":
        v = pag_dados.get("valor", 0)
        linhas.append(f"DINHEIRO: R${formatar_valor(v)}")
    elif pag_cat == "DINHEIRO_TROCO":
        vp = pag_dados.get("valor_pedido", 0)
        vr = pag_dados.get("valor_receber", 0)
        vt = pag_dados.get("valor_troco", 0)
        linhas.append(f"DINHEIRO: R${formatar_valor(vp)}")
        linhas.append(f"TROCO PARA: R${formatar_valor(vr)}")
        linhas.append(f"LEVAR: R${formatar_valor(vt)}")
    elif pag_cat == "DIN_MAQUINONA":
        v = pag_dados.get("valor", 0)
        linhas.append(f"DINHEIRO + MAQUINONA: R${formatar_valor(v)}")
    return linhas

def gerar_etiqueta(numero_pedido, pizza_num, total_pizzas, display_items, total_entrega,
                   pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido):
    img = Image.new("RGB", (LARGURA_PX, ALTURA_PX), "white")
    draw = ImageDraw.Draw(img)
    margem_e = 16; margem_d = 28; max_w = LARGURA_PX - margem_e - margem_d

    def cf(tamanho):
        try: return ImageFont.truetype("arialbd.ttf", tamanho)
        except:
            try: return ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", tamanho)
            except: return ImageFont.load_default()

    # ============================================================
    # HEADER: #0007 - 2/2 - COBRAR - 2387 - 15:19
    # Todas as informacoes no mesmo tamanho, auto-reduz se nao couber
    # ============================================================
    h_bar = 52
    draw.rectangle([(0, 0), (LARGURA_PX, h_bar)], fill="black")

    # Numero 4 digitos
    try: num_padded = f"{int(numero_pedido):04d}"
    except: num_padded = numero_pedido or "0000"

    # Status COBRAR ou PAGO
    status = "PAGO" if pag_cat == "PAGO" else "COBRAR"

    # Montar header inteiro
    partes = [f"#{num_padded}", f"{pizza_num}/{total_pizzas}", status]
    if balcao and nome_cliente:
        partes.append(f"{nome_cliente} BALCAO")
    elif balcao:
        partes.append("BALCAO")
    elif codigo_canal:
        partes.append(codigo_canal)
    if hora_pedido:
        partes.append(hora_pedido)
    header_texto = " - ".join(partes)

    # Auto-fit: 42 -> 36 -> 32 -> 28 -> 24
    font_h_size = 42
    for sz in [42, 36, 32, 28, 24, 20]:
        fh = cf(sz)
        try:
            bb = draw.textbbox((0,0), header_texto, font=fh)
            if (bb[2]-bb[0]) <= LARGURA_PX - margem_e - 8 - 8:
                font_h_size = sz; break
        except: pass

    font_header = cf(font_h_size)
    try:
        bb = draw.textbbox((0,0), header_texto, font=font_header)
        h_txt = bb[3] - bb[1]
        y_txt = (h_bar - h_txt) // 2 - 2
    except: y_txt = 4
    draw.text((margem_e, y_txt), header_texto, fill="white", font=font_header)

    # ============================================================
    # CONTEUDO: 2 colunas + bloco ITENS+PAGAMENTO no canto inf direito
    # Esquerda: pizzas salgadas + sabores + bordas
    # Direita TOPO: pizzas doces + bebidas + outros
    # Direita FINAL: ITENS + PAGAMENTO (fonte grande, mesmo tamanho do header)
    # ============================================================
    y_content = h_bar + 4
    content_h = ALTURA_PX - y_content - 2
    col_w = (LARGURA_PX - margem_e - margem_d) // 2
    mid_x = margem_e + col_w

    # Montar linhas esquerda e direita
    linhas_esq_raw = []
    linhas_dir_topo_raw = []  # itens do topo da direita

    for item in display_items:
        if item["tipo"] == "borda":
            linhas_esq_raw.append(("borda", f"Borda: {nome_borda_curto(item['nome'])}"))
        elif item["tipo"] == "caixa_salgada":
            sabores = item.get("sabores", [])
            if sabores:
                linhas_esq_raw.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: linhas_esq_raw.append(("sabores", f"  {s}"))
            else:
                linhas_esq_raw.append(("item", f"{item['qty']}x {item['nome']}"))
        elif item["tipo"] == "caixa_doce":
            sabores = item.get("sabores", [])
            if sabores:
                linhas_dir_topo_raw.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: linhas_dir_topo_raw.append(("sabores", f"  {s}"))
            else:
                linhas_dir_topo_raw.append(("item", f"{item['qty']}x {item['nome']}"))
        else:
            linhas_dir_topo_raw.append(("item", f"{item['qty']}x {item['nome']}"))

    # Linhas de destaque (ITENS + pagamento) com fonte grande
    linhas_pag = montar_linhas_pagamento(pag_cat, pag_dados)
    linhas_destaque = [f"ITENS: {total_entrega}"] + linhas_pag

    col_max_w = col_w - 8

    # ---- Dimensionar fonte do bloco DESTAQUE ----
    # Objetivo: maximizar tamanho dentro da coluna e espaco vertical
    # Maximo independente do header (tenta ate 48pt)
    max_espaco_destaque = int(content_h * 0.60)

    dest_size = 14
    for sz in range(48, 13, -2):
        fd = cf(sz)
        cabe_largura = True
        for linha in linhas_destaque:
            try:
                bb = draw.textbbox((0,0), linha, font=fd)
                if (bb[2]-bb[0]) > col_max_w: cabe_largura = False; break
            except: pass
        if not cabe_largura: continue
        try:
            bb = draw.textbbox((0,0), "Ag", font=fd)
            lh_d = (bb[3]-bb[1]) + 6
        except: lh_d = sz + 6
        h_total = lh_d * len(linhas_destaque)
        if h_total <= max_espaco_destaque:
            dest_size = sz; break

    font_dest = cf(dest_size)
    try:
        bb = draw.textbbox((0,0), "Ag", font=font_dest)
        dest_lh = (bb[3]-bb[1]) + 6
    except: dest_lh = dest_size + 6
    dest_h = dest_lh * len(linhas_destaque)

    # Espaco disponivel pros itens (acima do destaque)
    espaco_itens_h = content_h - dest_h - 4

    # ---- Dimensionar fonte dos ITENS ----
    # Items SEMPRE menor que destaque - max 60% do dest_size
    max_linhas_itens = max(len(linhas_esq_raw), len(linhas_dir_topo_raw), 1)
    lh_est = espaco_itens_h / max_linhas_itens if max_linhas_itens > 0 else espaco_itens_h
    font_size_max = max(int(dest_size * 0.6), 8)
    font_size = min(int(lh_est * 0.75), font_size_max, 14)
    font_size = max(font_size, 8)

    font_item = cf(font_size)
    font_sab = cf(max(font_size - 1, 8))
    font_borda = cf(max(font_size - 2, 8))

    def wrap_linhas(linhas_raw, mw):
        out = []
        for tipo, txt in linhas_raw:
            fu = font_item if tipo == "item" else (
                 font_borda if tipo == "borda" else font_sab)
            wrapped = word_wrap(txt, draw, fu, mw)
            for wl in wrapped: out.append((tipo, wl))
        return out

    linhas_esq_f = wrap_linhas(linhas_esq_raw, col_max_w)
    linhas_dir_topo_f = wrap_linhas(linhas_dir_topo_raw, col_max_w)

    # Recalcular se muitas linhas apos wrap
    max_f = max(len(linhas_esq_f), len(linhas_dir_topo_f), 1)
    if max_f > max_linhas_itens + 2:
        lh_est = espaco_itens_h / max_f
        new_size = min(int(lh_est * 0.72), 18)
        new_size = max(new_size, 8)
        if new_size < font_size - 1:
            font_size = new_size
            font_item = cf(font_size)
            font_sab = cf(max(font_size - 2, 8))
            font_borda = cf(max(font_size - 3, 8))
            linhas_esq_f = wrap_linhas(linhas_esq_raw, col_max_w)
            linhas_dir_topo_f = wrap_linhas(linhas_dir_topo_raw, col_max_w)
            max_f = max(len(linhas_esq_f), len(linhas_dir_topo_f), 1)

    lh_item = espaco_itens_h / max(max_f, 1)

    # Divisoria pontilhada entre colunas
    for dy in range(0, content_h, 6):
        draw.line([(mid_x, y_content+dy), (mid_x, y_content+dy+3)], fill="black", width=1)

    # Coluna esquerda (itens)
    y = y_content
    for tipo, txt in linhas_esq_f:
        fu = font_item if tipo == "item" else (
             font_borda if tipo == "borda" else font_sab)
        draw.text((margem_e, y), txt, fill="black", font=fu)
        y += lh_item

    # Coluna direita - TOPO (itens)
    y = y_content
    for tipo, txt in linhas_dir_topo_f:
        fu = font_item if tipo == "item" else (
             font_borda if tipo == "borda" else font_sab)
        draw.text((mid_x + 6, y), txt, fill="black", font=fu)
        y += lh_item

    # Coluna direita - BLOCO DESTAQUE (ITENS + pagamento) - fundo preto
    y_dest_start = ALTURA_PX - dest_h - 2
    # Fundo preto cobrindo toda a area do destaque no lado direito
    draw.rectangle([(mid_x + 2, y_dest_start - 2),
                    (LARGURA_PX, ALTURA_PX)], fill="black")
    y_dest = y_dest_start
    for linha in linhas_destaque:
        draw.text((mid_x + 6, y_dest), linha, fill="white", font=font_dest)
        y_dest += dest_lh

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
        cat, dados = extrair_pagamento(rows); bal = eh_retirada(rows)
        cn, cd = extrair_codigo_canal(rows); nc = extrair_nome_cliente(rows); hr = extrair_hora_pedido(rows)
        if id_sale and (cat or cd):
            cache_pagamento[id_sale] = {"pag_cat":cat,"pag_dados":dados,"balcao":bal,
                                        "canal":cn,"codigo_canal":cd,"nome_cliente":nc,"hora":hr}
            log(f"  NFCe: {id_sale} -> {cat} canal={cd}")
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
    except: pass

def processar_pedido(filepath, filename):
    data = ler_arquivo_saipos(filepath)
    if not data: log(f"  Parse falhou"); return
    if isinstance(data, dict): data = [data]
    id_sale = ""
    for el in data:
        s = str(el.get("id_sale", ""))
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

    pag_cat = ""; pag_dados = {}; balcao = False
    canal = ""; codigo_canal = ""; nome_cliente = ""; hora_pedido = ""
    for el in el_caixa:
        rows = el.get("printRows", [])
        c, d = extrair_pagamento(rows)
        if c: pag_cat = c; pag_dados = d
        if eh_retirada(rows): balcao = True
        cn, cd = extrair_codigo_canal(rows)
        if cd: canal = cn; codigo_canal = cd
        nc = extrair_nome_cliente(rows)
        if nc: nome_cliente = nc
        hr = extrair_hora_pedido(rows)
        if hr: hora_pedido = hr

    if not pag_cat:
        for el in el_cozinha:
            rows = el.get("printRows", []); c, d = extrair_pagamento(rows)
            if c: pag_cat = c; pag_dados = d
            if eh_retirada(rows): balcao = True
    if not codigo_canal:
        for el in el_cozinha:
            cn, cd = extrair_codigo_canal(el.get("printRows", []))
            if cd: canal = cn; codigo_canal = cd
    if not nome_cliente:
        for el in el_cozinha:
            nc = extrair_nome_cliente(el.get("printRows", []))
            if nc: nome_cliente = nc
    if not hora_pedido:
        for el in el_cozinha:
            hr = extrair_hora_pedido(el.get("printRows", []))
            if hr: hora_pedido = hr
    for el in el_cozinha:
        if eh_retirada(el.get("printRows", [])): balcao = True

    if not pag_cat or not codigo_canal:
        if id_sale and id_sale in cache_pagamento:
            cached = cache_pagamento[id_sale]
            if not pag_cat: pag_cat = cached.get("pag_cat", ""); pag_dados = cached.get("pag_dados", {})
            balcao = balcao or cached.get("balcao", False)
            if not codigo_canal: codigo_canal = cached.get("codigo_canal", ""); canal = cached.get("canal", "")
            if not nome_cliente: nome_cliente = cached.get("nome_cliente", "")
            if not hora_pedido: hora_pedido = cached.get("hora", "")
            log(f"  Cache: {pag_cat} canal={codigo_canal}")
        else:
            log(f"  Aguardando NFCe (5s)..."); time.sleep(5)
            if id_sale and id_sale in cache_pagamento:
                cached = cache_pagamento[id_sale]
                if not pag_cat: pag_cat = cached.get("pag_cat", ""); pag_dados = cached.get("pag_dados", {})
                balcao = balcao or cached.get("balcao", False)
                if not codigo_canal: codigo_canal = cached.get("codigo_canal", ""); canal = cached.get("canal", "")
                if not nome_cliente: nome_cliente = cached.get("nome_cliente", "")
                if not hora_pedido: hora_pedido = cached.get("hora", "")
                log(f"  Cache NFCe: {pag_cat} canal={codigo_canal}")

    if id_sale: processados_id_sale[id_sale] = time.time()

    # ITENS do CAIXA
    el_itens = el_caixa if el_caixa else el_cozinha
    all_display = []; numero_pedido = ""
    for el in el_itens:
        rows = el.get("printRows", []); num = extrair_numero_pedido(rows)
        if num: numero_pedido = num
        display, cx, bb, ou = extrair_itens_printrows(rows); all_display.extend(display)
    if not numero_pedido:
        for el in (el_cozinha if el_caixa else el_caixa):
            num = extrair_numero_pedido(el.get("printRows", []))
            if num: numero_pedido = num; break

    all_display = agrupar_display(all_display)
    total_caixas = sum(d["qty"] for d in all_display if d["tipo"] in ("caixa_salgada", "caixa_doce"))
    total_bebidas = sum(d["qty"] for d in all_display if d["tipo"] == "bebida")
    total_outros = sum(d["qty"] for d in all_display if d["tipo"] == "outro")
    total_entrega = total_caixas + total_bebidas + total_outros

    log(f"  #{numero_pedido}: {total_caixas}cx {total_bebidas}beb {total_outros}out = {total_entrega} | {pag_cat} | canal={codigo_canal} | {'BALCAO' if balcao else 'ENTREGA'} | {nome_cliente} | {hora_pedido}")

    if total_caixas == 0 and total_entrega == 0:
        log(f"  Sem itens")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return

    num_etiquetas = max(total_caixas, 1)
    for i in range(1, num_etiquetas + 1):
        img = gerar_etiqueta(numero_pedido, i, num_etiquetas, all_display, total_entrega,
                             pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido)
        log(f"  Etiqueta {i}/{num_etiquetas}..."); imprimir_etiqueta(img)
        if i < num_etiquetas: time.sleep(0.5)
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log(f"  Movido")
    except: pass
    log(f"  OK #{numero_pedido} - {num_etiquetas} etiqueta(s)!")

def processar_arquivo(filepath):
    filename = os.path.basename(filepath)
    if filename in processados_arquivos and (time.time() - processados_arquivos[filename]) < 30: return
    processados_arquivos[filename] = time.time(); log(f"Arquivo: {filename}")
    if filename.lower().startswith("nfce_"): processar_nfce(filepath, filename); return
    processar_pedido(filepath, filename)

class SaiposHandler(FileSystemEventHandler):
    def on_created(self, event): self._processar(event.src_path)
    def on_moved(self, event): self._processar(event.dest_path)
    def _processar(self, filepath):
        if os.path.isdir(filepath): return
        fn = os.path.basename(filepath).lower()
        if fn.endswith(".saiposprt") or fn.endswith(".saiposnfeprt"):
            time.sleep(1)
            try: processar_arquivo(filepath)
            except Exception as e: log(f"ERRO: {fn}: {e}")

def main():
    print("=" * 60)
    print(f"  ETIQUETA SAIPOS -> ELGIN L42PRO FULL  (v{VERSION})")
    print("  Pizzaria Estrela da Ilha - BOPP 80x30mm")
    print("=" * 60 + "\n")
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
    handler = SaiposHandler(); observer = Observer()
    observer.schedule(handler, PASTA_DOWNLOADS, recursive=False); observer.start()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt: log("Script encerrado"); observer.stop()
    observer.join()

if __name__ == "__main__": main()
