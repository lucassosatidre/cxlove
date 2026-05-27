"""
ETIQUETA SAIPOS -> ELGIN L42PRO FULL
Pizzaria Estrela da Ilha
v14.5 - Ordem fixa na coluna direita: outros -> brotos (penultimo) -> bebidas (ultimo)
"""

VERSION = "152"
UPDATE_URL = "https://raw.githubusercontent.com/lucassosatidre/cxlove/main/etiqueta_saipos.py"

import os, sys, json, re, time, subprocess, tempfile, base64, shutil, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo
    _BR_TZ = ZoneInfo("America/Sao_Paulo")
except Exception:
    _BR_TZ = timezone(timedelta(hours=-3))

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

def montar_rodape_linha(total_entrega, pag_cat, pag_dados):
    """Retorna UMA linha pro rodape: ITENS + pagamento (sem LEVAR em troco)"""
    if pag_cat == "PAGO":
        return f"ITENS: {total_entrega} - PAGO"
    if pag_cat == "MAQUINONA":
        return f"ITENS: {total_entrega} - MAQUINONA: R${formatar_valor(pag_dados.get('valor',0))}"
    if pag_cat == "DINHEIRO":
        return f"ITENS: {total_entrega} - DINHEIRO: R${formatar_valor(pag_dados.get('valor',0))}"
    if pag_cat == "DINHEIRO_TROCO":
        vp = pag_dados.get("valor_pedido", 0)
        vr = pag_dados.get("valor_receber", 0)
        return f"ITENS: {total_entrega} - DINHEIRO: R${formatar_valor(vp)} - TROCO PARA: R${formatar_valor(vr)}"
    if pag_cat == "DIN_MAQUINONA":
        return f"ITENS: {total_entrega} - DIN+MAQUINONA: R${formatar_valor(pag_dados.get('valor',0))}"
    return f"ITENS: {total_entrega}"

def gerar_etiqueta(numero_pedido, pizza_num, total_pizzas, display_items, total_entrega,
                   pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido):
    """v14.4 - Rodape simetrico + N colunas adaptativas + distribuicao balanceada"""
    img = Image.new("RGB", (LARGURA_PX, ALTURA_PX), "white")
    draw = ImageDraw.Draw(img)
    margem_e = 16
    margem_d = 16
    LIMIAR_2COL = 16  # fonte minima aceitavel pra preferir 2 colunas

    def cf(tamanho):
        try: return ImageFont.truetype("arialbd.ttf", tamanho)
        except:
            try: return ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", tamanho)
            except: return ImageFont.load_default()

    # ============================================================
    # 1. Monta texto do HEADER
    # ============================================================
    try: num_padded = f"{int(numero_pedido):04d}"
    except: num_padded = numero_pedido or "0000"
    status = "PAGO" if pag_cat == "PAGO" else "COBRAR"
    partes = [f"#{num_padded}", f"{pizza_num}/{total_pizzas}", status]
    if balcao and nome_cliente: partes.append(f"{nome_cliente} BALCAO")
    elif balcao: partes.append("BALCAO")
    elif codigo_canal: partes.append(codigo_canal)
    if hora_pedido: partes.append(hora_pedido)
    header_texto = " - ".join(partes)

    max_barra_w = LARGURA_PX - margem_e - 16

    # Auto-fit granular do header (1pt por vez)
    def auto_fit_1linha(texto, teto, piso=10):
        fs = piso
        for sz in range(teto, piso - 1, -1):
            fh = cf(sz)
            try:
                bb = draw.textbbox((0,0), texto, font=fh)
                if (bb[2]-bb[0]) <= max_barra_w: fs = sz; break
            except: pass
        return fs

    fs_header = auto_fit_1linha(header_texto, teto=42, piso=14)

    def calc_h_barra(texto, fs):
        fh = cf(fs)
        try:
            bb = draw.textbbox((0,0), "Ag", font=fh); lh = (bb[3]-bb[1]) + 8
        except: lh = fs + 8
        return lh + 4

    h_header = calc_h_barra(header_texto, fs_header)

    # ============================================================
    # 2. Monta texto do RODAPE (simetria: teto = fs_header)
    # ============================================================
    linha_rodape = montar_rodape_linha(total_entrega, pag_cat, pag_dados)
    fs_rodape = auto_fit_1linha(linha_rodape, teto=fs_header, piso=10)
    h_rodape = calc_h_barra(linha_rodape, fs_rodape)

    # ============================================================
    # 3. Renderiza HEADER (faixa preta em cima)
    # ============================================================
    def render_barra(texto, y_start, h, fs):
        draw.rectangle([(0, y_start), (LARGURA_PX, y_start + h)], fill="black")
        fh = cf(fs)
        try:
            bb = draw.textbbox((0,0), texto, font=fh)
            y = y_start + (h - (bb[3]-bb[1]))//2 - 2
        except: y = y_start + 2
        draw.text((margem_e, y), texto, fill="white", font=fh)

    render_barra(header_texto, 0, h_header, fs_header)

    # ============================================================
    # 4. Separa itens em blocos: pizzas salgadas (com sabores e bordas juntas)
    #    vs fixo direita (brotos doces + bebidas + outros) com ORDEM fixa:
    #    outros -> brotos (penultimo) -> bebidas (ultimo)
    # ============================================================
    # Primeiro: anexa borda ao bloco da pizza salgada anterior
    # (Borda sempre vem depois da pizza a que se refere no Saipos)
    blocos_salgadas = []  # cada bloco: [(tipo, linha), ...]
    fixo_outros = []   # tipo "outro" (batata, sobremesa avulsa, etc)
    fixo_brotos = []   # tipo "caixa_doce" - penultimo na direita
    fixo_bebidas = []  # tipo "bebida" - ultimo na direita
    for item in display_items:
        if item["tipo"] == "borda":
            if blocos_salgadas:
                blocos_salgadas[-1].append(("borda", f"Borda: {nome_borda_curto(item['nome'])}"))
            else:
                blocos_salgadas.append([("borda", f"Borda: {nome_borda_curto(item['nome'])}")])
        elif item["tipo"] == "caixa_salgada":
            bloco = []
            sabores = item.get("sabores", [])
            if sabores:
                bloco.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: bloco.append(("sabores", f"  {s}"))
            else:
                bloco.append(("item", f"{item['qty']}x {item['nome']}"))
            blocos_salgadas.append(bloco)
        elif item["tipo"] == "caixa_doce":
            sabores = item.get("sabores", [])
            if sabores:
                fixo_brotos.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: fixo_brotos.append(("sabores", f"  {s}"))
            else:
                fixo_brotos.append(("item", f"{item['qty']}x {item['nome']}"))
        elif item["tipo"] == "bebida":
            fixo_bebidas.append(("item", f"{item['qty']}x {item['nome']}"))
        else:  # "outro"
            fixo_outros.append(("item", f"{item['qty']}x {item['nome']}"))

    # Ordem final da coluna direita: outros -> brotos -> bebidas
    fixo_dir = fixo_outros + fixo_brotos + fixo_bebidas


    # ============================================================
    # 5. Escolhe N colunas (2-5) - prefere 2, sobe se fonte < LIMIAR
    # ============================================================
    y_meio = h_header + 4
    altura_meio = ALTURA_PX - h_rodape - y_meio - 4
    largura_total = LARGURA_PX - margem_e - margem_d

    def wrap_col(col_raw, col_w, fi, fs, fb):
        out = []
        for tipo, txt in col_raw:
            fu = fi if tipo == "item" else (fb if tipo == "borda" else fs)
            for l in word_wrap(txt, draw, fu, col_w): out.append((tipo, l))
        return out

    def distribuir_balanceado(blocos, fixo, n):
        """Distribui blocos de pizzas salgadas em n colunas via greedy.
        Fixo (outros+brotos+bebidas) vai NO FINAL da ultima coluna, garantindo
        que a bebida seja sempre o ultimo item. O greedy considera o peso do
        fixo ao decidir pra onde cada pizza vai (pra manter balanceamento)."""
        if n <= 0: return []
        cols = [[] for _ in range(n)]
        fixo_len = len(fixo)
        for b in blocos:
            def custo(i):
                return len(cols[i]) + (fixo_len if i == n - 1 else 0)
            idx = min(range(n), key=custo)
            cols[idx].extend(b)
        cols[-1].extend(fixo)
        return cols

    def testar_n_colunas(n, max_fonte=42):
        if n <= 0: return 0, None
        col_w_n = largura_total // n
        col_max_w = col_w_n - 8
        cols = distribuir_balanceado(blocos_salgadas, fixo_dir, n)
        if any(len(c) == 0 for c in cols) and n > 2:
            return 0, None  # coluna vazia em 3+ eh desperdicio
        for sz in range(max_fonte, 9, -1):
            fi = cf(sz); fsab = cf(max(sz-1, 8)); fb = cf(max(sz-2, 8))
            try:
                bb = draw.textbbox((0,0), "Ag", font=fi); lh = (bb[3]-bb[1]) + 4
            except: lh = sz + 4
            cols_w = [wrap_col(c, col_max_w, fi, fsab, fb) for c in cols]
            max_linhas = max([len(c) for c in cols_w] + [1])
            if max_linhas * lh <= altura_meio:
                return sz, {
                    "n": n, "col_w": col_w_n, "cols_w": cols_w,
                    "lh": lh, "fi": fi, "fsab": fsab, "fb": fb
                }
        return 0, None

    # Prefere 2 col se fonte >= LIMIAR; senao busca o N que da fonte maior
    sz2, dados2 = testar_n_colunas(2)
    if sz2 >= LIMIAR_2COL:
        sz_itens, dados = sz2, dados2
    else:
        melhor = (sz2, dados2) if sz2 > 0 else (0, None)
        for n in range(3, 6):
            sz, d = testar_n_colunas(n)
            if sz > melhor[0]:
                melhor = (sz, d)
        sz_itens, dados = melhor

    # ============================================================
    # 6. Renderiza o MEIO (colunas) e divisorias
    # ============================================================
    if dados:
        n = dados["n"]; col_w = dados["col_w"]; lh = dados["lh"]
        fi = dados["fi"]; fsab = dados["fsab"]; fb = dados["fb"]

        # Divisorias pontilhadas entre colunas
        for c in range(1, n):
            x_div = margem_e + col_w * c
            for dy in range(0, altura_meio, 6):
                draw.line([(x_div, y_meio+dy), (x_div, y_meio+dy+3)], fill="black", width=1)

        # Texto de cada coluna
        for i, col in enumerate(dados["cols_w"]):
            x_col = margem_e + col_w * i + (4 if i > 0 else 0)
            y = y_meio
            for tipo, txt in col:
                fu = fi if tipo == "item" else (fb if tipo == "borda" else fsab)
                draw.text((x_col, y), txt, fill="black", font=fu)
                y += lh

    # ============================================================
    # 7. Renderiza RODAPE (faixa preta embaixo)
    # ============================================================
    render_barra(linha_rodape, ALTURA_PX - h_rodape, h_rodape, fs_rodape)

    return img



def imprimir_etiqueta(img, printer_name=None, larg=None, alt=None):
    printer_name = printer_name or NOME_IMPRESSORA
    larg = larg if larg else LARGURA_PX
    alt = alt if alt else ALTURA_PX
    tmp = tempfile.NamedTemporaryFile(suffix=".bmp", delete=False); tmp_path = tmp.name; tmp.close()
    try:
        img.save(tmp_path, "BMP")
        try:
            import win32print, win32ui; from PIL import ImageWin
            hdc = win32ui.CreateDC(); hdc.CreatePrinterDC(printer_name)
            hdc.StartDoc("Etiqueta Saipos"); hdc.StartPage()
            ImageWin.Dib(img).draw(hdc.GetHandleOutput(), (0, 0, larg, alt))
            hdc.EndPage(); hdc.EndDoc(); hdc.DeleteDC(); log(f"  Impresso OK ({printer_name})")
        except ImportError:
            subprocess.run(f'mspaint /pt "{tmp_path}" "{printer_name}"', shell=True, capture_output=True, timeout=10)
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

    impressora_cx = _impressora_para(IP_IMPRESSORA_CAIXAS, fallback=NOME_IMPRESSORA, etiqueta="CAIXAS")
    num_etiquetas = max(total_caixas, 1)
    for i in range(1, num_etiquetas + 1):
        img = gerar_etiqueta(numero_pedido, i, num_etiquetas, all_display, total_entrega,
                             pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido)
        log(f"  Etiqueta {i}/{num_etiquetas}..."); imprimir_etiqueta(img, printer_name=impressora_cx)
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

# ============================================================
# CO LOVE - Etiquetas de Producao (.lovelabel)
# ============================================================
_LOVELABEL_SEEN = {}
_LOVELABEL_DEDUP_S = 5

# --- Impressoras achadas pelo IP FIXO na rede (o nome no Windows varia por PC) ---
# Caixas (comandas) 80x30mm  e  Producao do CO LOVE 50x25mm sao 2 impressoras de rede.
IP_IMPRESSORA_CAIXAS   = "192.168.1.14"   # comandas das caixas (80x30)
IP_IMPRESSORA_PRODUCAO = "192.168.1.24"   # etiquetas de validade CO LOVE (50x25)

CO_LOVE_LARGURA_MM = 50
CO_LOVE_ALTURA_MM = 25
CO_LOVE_LARGURA_PX = int(CO_LOVE_LARGURA_MM * DPI / 25.4)   # ~399 px @ 203 DPI
CO_LOVE_ALTURA_PX = int(CO_LOVE_ALTURA_MM * DPI / 25.4)     # ~199 px @ 203 DPI

_cache_impressora_ip = {}

def _ip_da_porta(port_name):
    """Descobre o IP de uma porta de impressora (pelo nome da porta ou pelo registro)."""
    m = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', port_name or "")
    if m: return m.group(1)
    try:
        import winreg
        base = r"SYSTEM\CurrentControlSet\Control\Print\Monitors\Standard TCP/IP Port\Ports"
        chave = base + "\\" + (port_name or "")
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, chave) as k:
            for nome_valor in ("IPAddress", "HostName"):
                try:
                    v, _ = winreg.QueryValueEx(k, nome_valor)
                    mm = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', str(v))
                    if mm: return mm.group(1)
                except Exception:
                    continue
    except Exception:
        pass
    return None

def _achar_impressora_por_ip(ip):
    try:
        import win32print
    except Exception:
        return None
    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        impressoras = win32print.EnumPrinters(flags, None, 2)
    except Exception as e:
        log(f"  erro lendo impressoras: {e}")
        return None
    for p in impressoras:
        if _ip_da_porta(p.get("pPortName", "")) == ip:
            return p.get("pPrinterName", "")
    return None

def _impressora_para(ip, fallback=None, etiqueta=""):
    """Nome (Windows) da impressora que esta no IP dado. Cacheia so o sucesso."""
    nome = _cache_impressora_ip.get(ip)
    if nome: return nome
    nome = _achar_impressora_por_ip(ip)
    if nome:
        _cache_impressora_ip[ip] = nome
        log(f"  {etiqueta}: impressora '{nome}' (IP {ip})")
        return nome
    log(f"  {etiqueta}: nenhuma impressora no IP {ip} -> usando '{fallback}'")
    return fallback

def _prod_fonte_bold(tamanho):
    for p in ("arialbd.ttf", "C:\\Windows\\Fonts\\arialbd.ttf",
              "/Library/Fonts/Arial Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try: return ImageFont.truetype(p, tamanho)
        except: continue
    return ImageFont.load_default()

def _prod_fonte_normal(tamanho):
    for p in ("arial.ttf", "C:\\Windows\\Fonts\\arial.ttf",
              "/Library/Fonts/Arial.ttf",
              "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try: return ImageFont.truetype(p, tamanho)
        except: continue
    return ImageFont.load_default()

def _prod_data_br(iso_str):
    try:
        y, m, d = iso_str.split("-")
        return f"{d}/{m}/{y}"
    except: return iso_str or ""

def _prod_hora_br(iso_str):
    """Extrai HH:MM de um timestamp ISO (printed_at) convertendo pra America/Sao_Paulo."""
    if not iso_str: return ""
    try:
        s = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_BR_TZ).strftime("%H:%M")
    except Exception:
        return ""

# Detecta gramatura no final do nome: "PARMESÃO 30G", "ABACAXI 100G", "ALCATRA 130G", etc
_PORCAO_RE = re.compile(r'\s+(\d+(?:[.,]\d+)?)\s*[Gg]\s*$')

def _extrair_porcao(nome):
    """Retorna (nome_sem_porcao, 'NNG'|None)."""
    m = _PORCAO_RE.search(nome)
    if not m:
        return nome.strip(), None
    qtd = m.group(1).replace(",", ".")
    if qtd.endswith(".0"): qtd = qtd[:-2]
    return _PORCAO_RE.sub("", nome).strip(), f"{qtd}G"

def _prod_fit(draw, texto, max_w, max_h, bold=True, tam_max=72, tam_min=10):
    loader = _prod_fonte_bold if bold else _prod_fonte_normal
    for s in range(tam_max, tam_min - 1, -1):
        f = loader(s)
        bb = draw.textbbox((0, 0), texto, font=f)
        if (bb[2] - bb[0]) <= max_w and (bb[3] - bb[1]) <= max_h: return f
    return loader(tam_min)

def _prod_wrap(draw, texto, font, max_w):
    palavras, linhas, atual = texto.split(), [], ""
    for p in palavras:
        t = (atual + " " + p).strip()
        bb = draw.textbbox((0, 0), t, font=font)
        if (bb[2] - bb[0]) <= max_w: atual = t
        else:
            if atual: linhas.append(atual)
            atual = p
    if atual: linhas.append(atual)
    return linhas

def gerar_etiqueta_producao(payload, larg=None, alt=None):
    """
    Layout CO LOVE v150 — etiqueta 50x25mm (impressora separada, achada por IP):
    - FAIXA PRETA NO TOPO com nome do insumo em BRANCO BOLD (gramatura
      detectada vai pro rodapé como 'PORÇÃO: NNG').
    - FAB / VAL no meio (texto preto, fonte normal).
    - Porção + Responsável embaixo (texto preto, fonte normal, sem fundo).
    """
    larg = larg if larg else CO_LOVE_LARGURA_PX
    alt = alt if alt else CO_LOVE_ALTURA_PX
    img = Image.new("RGB", (larg, alt), "white")
    draw = ImageDraw.Draw(img)
    margem_e, margem_d, margem_b = 16, 28, 6

    nome_raw = (payload.get("product_name") or "?").upper()
    nome, porcao = _extrair_porcao(nome_raw)
    fab = _prod_data_br(payload.get("manufacture_date") or "")
    val = _prod_data_br(payload.get("expiry_date") or "")
    hora = _prod_hora_br(payload.get("printed_at") or "")
    resp = (payload.get("responsible_name") or "?").strip().upper()

    largura_util = larg - margem_e - margem_d
    altura_util = alt - margem_b

    h_nome = int(altura_util * 0.50)   # faixa preta no topo
    h_datas = int(altura_util * 0.25)
    h_resp = altura_util - h_nome - h_datas

    y_nome = 0
    y_datas = h_nome
    y_resp = y_datas + h_datas

    # ---- Faixa preta no TOPO com nome em branco (BOLD)
    draw.rectangle([0, 0, larg, h_nome], fill="black")
    f_nome = _prod_fit(draw, nome, largura_util, h_nome - 10, bold=True, tam_max=72, tam_min=20)
    bb = draw.textbbox((0, 0), nome, font=f_nome)
    if (bb[2] - bb[0]) <= largura_util:
        lh = bb[3] - bb[1]
        x = margem_e + (largura_util - (bb[2] - bb[0])) // 2
        y = y_nome + (h_nome - lh) // 2 - 4
        draw.text((x, y), nome, fill="white", font=f_nome)
    else:
        for s in range(50, 14, -2):
            f_tmp = _prod_fonte_bold(s)
            linhas = _prod_wrap(draw, nome, f_tmp, largura_util)
            if len(linhas) > 2: continue
            line_h = draw.textbbox((0, 0), "Ag", font=f_tmp)[3]
            total_h = line_h * len(linhas) + 2 * (len(linhas) - 1)
            if total_h <= h_nome - 10:
                y0 = y_nome + (h_nome - total_h) // 2 - 2
                for i, l in enumerate(linhas):
                    bbl = draw.textbbox((0, 0), l, font=f_tmp)
                    lw = bbl[2] - bbl[0]
                    x = margem_e + (largura_util - lw) // 2
                    draw.text((x, y0 + i * (line_h + 2)), l, fill="white", font=f_tmp)
                break

    # ---- FAB / VAL (fonte BOLD preta — nitidez na térmica) — hora anexada ao FAB quando disponível
    label_fab = f"FAB: {fab} {hora}".rstrip() if hora else f"FAB: {fab}"
    label_val = f"VAL: {val}"
    metade = largura_util // 2
    f_a = _prod_fit(draw, label_val, metade - 8, h_datas - 4, bold=True, tam_max=40, tam_min=14)
    f_b = _prod_fit(draw, label_fab, metade - 8, h_datas - 4, bold=True, tam_max=40, tam_min=14)
    f_dat = f_b if f_b.size < f_a.size else f_a
    bb_fab = draw.textbbox((0, 0), label_fab, font=f_dat)
    bb_val = draw.textbbox((0, 0), label_val, font=f_dat)
    h_label = max(bb_fab[3] - bb_fab[1], bb_val[3] - bb_val[1])
    y_label = y_datas + (h_datas - h_label) // 2 - 2
    draw.text((margem_e, y_label), label_fab, fill="black", font=f_dat)
    draw.text((larg - margem_d - (bb_val[2] - bb_val[0]), y_label), label_val, fill="black", font=f_dat)

    # ---- Porção + Responsável (fonte NORMAL preta, sem fundo)
    if porcao:
        label_resp = f"PORÇÃO: {porcao}   RESPONSÁVEL: {resp}"
    else:
        label_resp = f"RESPONSÁVEL: {resp}"
    f_resp = _prod_fit(draw, label_resp, largura_util - 4, h_resp - 4, bold=True, tam_max=32, tam_min=10)
    bb_r = draw.textbbox((0, 0), label_resp, font=f_resp)
    rw, rh = bb_r[2] - bb_r[0], bb_r[3] - bb_r[1]
    rx = margem_e + (largura_util - rw) // 2
    ry = y_resp + (h_resp - rh) // 2 - 2
    draw.text((rx, ry), label_resp, fill="black", font=f_resp)

    # Térmica: remove o cinza do anti-aliasing -> preto puro ou branco puro (nitidez)
    img = img.convert("L").point(lambda p: 0 if p < 190 else 255).convert("RGB")
    return img

def processar_lovelabel(filepath, filename):
    try:
        time.sleep(0.6)
        with open(filepath, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        log(f"  ERRO lendo .lovelabel: {e}"); return
    if payload.get("type") != "producao":
        log(f"  .lovelabel ignorado (type != producao)"); return
    batch_id = payload.get("batch_id", "?")
    is_reprint = bool(payload.get("reprint"))
    now = time.time()
    last = _LOVELABEL_SEEN.get(batch_id)
    if last and (now - last) < _LOVELABEL_DEDUP_S and not is_reprint:
        log(f"  dedup .lovelabel {str(batch_id)[:8]}")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return
    _LOVELABEL_SEEN[batch_id] = now
    qtd = max(1, min(50, int(payload.get("quantity", 1))))
    nome = payload.get("product_name", "?")
    log(f"  CO LOVE: {qtd}x '{nome}' (batch {str(batch_id)[:8]}{'/REIMP' if is_reprint else ''})")
    impressora = _impressora_para(IP_IMPRESSORA_PRODUCAO, fallback=NOME_IMPRESSORA, etiqueta="PRODUCAO")
    img = gerar_etiqueta_producao(payload)
    for i in range(qtd):
        try: imprimir_etiqueta(img, printer_name=impressora, larg=CO_LOVE_LARGURA_PX, alt=CO_LOVE_ALTURA_PX)
        except Exception as e: log(f"  ERRO imp {i+1}/{qtd}: {e}"); break
        time.sleep(0.2)
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log(f"  Movido")
    except Exception as e: log(f"  ERRO mover: {e}")


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
        elif fn.endswith(".lovelabel"):
            try: processar_lovelabel(filepath, os.path.basename(filepath))
            except Exception as e: log(f"ERRO lovelabel: {fn}: {e}")

def main():
    print("=" * 60)
    print(f"  ETIQUETA SAIPOS -> ELGIN L42PRO FULL  (v{VERSION})")
    print("  Pizzaria Estrela da Ilha - BOPP 80x30mm")
    print("=" * 60 + "\n")
    print(f"  Usuario:     {os.path.expanduser('~')}")
    print(f"  Monitorando: {PASTA_DOWNLOADS}")
    print(f"  Impressora:  {NOME_IMPRESSORA}")
    print(f"  Caixas:      {LARGURA_MM}x{ALTURA_MM}mm  (IP {IP_IMPRESSORA_CAIXAS})")
    print(f"  CO LOVE:     {CO_LOVE_LARGURA_MM}x{CO_LOVE_ALTURA_MM}mm  (IP {IP_IMPRESSORA_PRODUCAO})\n")
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
