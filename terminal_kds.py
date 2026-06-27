# -*- coding: utf-8 -*-
# ===========================================================================
# TERMINAL KDS -> CO LOVE  (Pizzaria Estrela da Ilha)
# Le os pedidos AO VIVO do KDS do Saipos (Firebase) e manda pra cozinha (CO LOVE).
# Roda continuamente. Salva log na pasta "logs".
#
# >>> RODE COM O SCRIPT DE ETIQUETA FECHADO NESTE PC (pra nao duplicar comanda). <<<
#
# PRIMEIRA VEZ: deixe ENVIAR = False  -> ele so MOSTRA o que mandaria (modo conferencia).
#   Mande o log pro assistente conferir. Depois mude pra ENVIAR = True e rode de novo.
# ===========================================================================

import json, ssl, sys, os, time, codecs, hashlib, datetime, re, urllib.request, urllib.parse, urllib.error

# ---------- CONFIG ----------
VERSION = "8"             # versao do terminal. O auto-update compara este numero com o do GitHub.
# v8 (27/06/26): robustez (auditoria). (1) RTDB 401/403 forca re-auth no proximo ciclo (antes o robo
#   ficava CEGO ate ~58min); (2) auto-update e download do cerebro agora ATOMICOS + validados (compile)
#   -> download truncado nao brica mais o robo; (3) se o GitHub cair, usa o cerebro LOCAL em disco em vez
#   de travar o boot; (4) pedido que estoura no parser vira ALERTA forte no log apos 3 ciclos (antes
#   sumia em silencio pra sempre). Sem mudanca de fluxo normal.
# v7 (27/06/26): conserta o ACENTO do NOME do cliente (iFood/Brendi). O Firebase as vezes manda 1 byte
#   Latin-1/cp1252 (ex.: E=0xC9) no customerFirstName num corpo senao UTF-8; o decode antigo
#   ("replace") trocava por "�" (JOS�). Agora o decode tem fallback cp1252 SO no(s) byte(s) invalido(s)
#   -> recupera o acento (JOSE com acento) sem mexer no resto do corpo UTF-8 (itens/emoji intactos).
#   Ver _utf8_cp1252 + _http. (itens ja saiam limpos; a quebra era so no nome.)
# v6 (09/06/26): DIAGNOSTICO temporario — anexa no payload (kds_debug) o resumo de TODAS as fichas que o
#   robo viu no KDS no ciclo, p/ mapear ficha de broto que aparece separada (estacao diferente) e nao
#   agrupa no pedido. Sem efeito no fluxo; servidor guarda no comanda_events p/ analise. Remover depois.
# v5 (08/06/26): o robo agora RECARREGA o cerebro (etiqueta_saipos.py) a cada ciclo de update, nao so
#   no boot -> correcoes do parser (borda/adicional/etc.) passam a valer sem reiniciar o robo. Antes o
#   cerebro so era lido ao (re)iniciar; bump so do etiqueta_saipos NAO chegava no robo em execucao.
UPDATE_URL = "https://raw.githubusercontent.com/lucassosatidre/cxlove/main/terminal_kds.py"
ETIQUETA_URL = "https://raw.githubusercontent.com/lucassosatidre/cxlove/main/etiqueta_saipos.py"  # o CEREBRO (parser+IA)
UPDATE_EVERY = 300        # checa atualizacao a cada 5 min (e no boot)
EMAIL   = "terminalimpressoras@saipos.com"
SENHA   = ""              # NAO cole a senha aqui (este arquivo vai pro GitHub publico).
                          # Crie um arquivo "senha.txt" NESTA PASTA com a senha do terminalimpressoras@saipos.com.
ENVIAR  = True            # False = so loga (conferencia) | True = manda pra cozinha de verdade
MODO_SOMBRA = False       # True = manda pra ABA FANTASMA do CO LOVE (valida SEM mexer na cozinha real). TEM PRIORIDADE.
POLL_SEG = 5              # de quantos em quantos segundos confere o KDS

ID_STORE     = "42566"
STORE_HASH   = "6087dc9cb1c079a45944d7490ef67ea2"
FIREBASE_KEY = "AIzaSyDNVhVFnFQHNMZRgFscXtfWKoGZ2vkLQ6Q"
RTDB         = "https://saipos-67ffe-kds.firebaseio.com"
COMANDA_ENDPOINT = "https://vqlfrbugmdnlyxzrlrzt.supabase.co/functions/v1/ingest-comanda"
SHADOW_ENDPOINT  = "https://vqlfrbugmdnlyxzrlrzt.supabase.co/functions/v1/ingest-terminal-shadow"

CTX = ssl.create_default_context()

# ---------- log (tela + arquivo) ----------
_LOGDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(_LOGDIR, exist_ok=True)
_LOGFILE = open(os.path.join(_LOGDIR, "terminal_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S") + ".txt"), "a", encoding="utf-8")
def log(*a):
    msg = datetime.datetime.now().strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(msg)
    try: _LOGFILE.write(msg + "\n"); _LOGFILE.flush()
    except Exception: pass

# ---------- decode robusto (recupera acento Latin-1/cp1252 em vez de virar "�") ----------
# O Firebase as vezes traz 1 byte cp1252 solto (acento de nome iFood/Brendi) num corpo senao UTF-8.
# Em vez de decode("utf-8","replace") (que apaga o byte -> "�"), este handler decodifica SO o(s)
# byte(s) invalido(s) como cp1252 -> recupera o acento; o resto do corpo UTF-8 passa intacto.
def _utf8_cp1252(err):
    return (err.object[err.start:err.end].decode("cp1252", "replace"), err.end)
codecs.register_error("utf8_cp1252", _utf8_cp1252)

# ---------- HTTP ----------
def _http(url, method="GET", body=None, headers=None):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers: h.update(headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
            t = r.read().decode("utf-8", "utf8_cp1252")  # recupera acento Latin-1 em vez de "�"
            return r.getcode(), (json.loads(t) if t.strip()[:1] in ("{", "[") else t)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"

# ---------- AUTH (chave de 1h, renova sozinha) ----------
_auth = {"saipos": None, "idtoken": None, "refresh": None, "exp": 0}
def _login_saipos():
    c, r = _http("https://api.saipos.com/v1/users/login?include=user", "POST",
                 {"email": EMAIL, "password": SENHA, "force": True})
    if c == 200 and isinstance(r, dict) and r.get("id"):
        _auth["saipos"] = r["id"]; return True
    log("ERRO login Saipos:", c, r); return False
def _renova_idtoken():
    # custom token -> id token
    c, fb = _http(f"https://api.saipos.com/v1/stores/{ID_STORE}/generate-firebase-token", "POST", {},
                  {"Authorization": _auth["saipos"]})
    custom = (fb.get("default") or fb.get("token")) if isinstance(fb, dict) else None
    if not custom:
        log("ERRO generate-firebase-token:", c, fb); return False
    c, vr = _http(f"https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key={FIREBASE_KEY}",
                  "POST", {"token": custom, "returnSecureToken": True})
    if not (isinstance(vr, dict) and vr.get("idToken")):
        log("ERRO verifyCustomToken:", c, vr); return False
    _auth["idtoken"] = vr["idToken"]; _auth["refresh"] = vr.get("refreshToken")
    _auth["exp"] = time.time() + int(vr.get("expiresIn", 3600)) - 120  # renova 2min antes
    return True
def idtoken():
    if _auth["idtoken"] and time.time() < _auth["exp"]:
        return _auth["idtoken"]
    if not _auth["saipos"] and not _login_saipos():
        return None
    if not _renova_idtoken():
        # tenta relogar 1x (token saipos pode ter caido)
        if _login_saipos() and _renova_idtoken(): return _auth["idtoken"]
        return None
    return _auth["idtoken"]

# ---------- LEITURA do KDS ----------
def ler_kds():
    tk = idtoken()
    if not tk: return None
    c, data = _http(f"{RTDB}/stores/{STORE_HASH}.json?auth={urllib.parse.quote(tk)}", "GET")
    if c == 200 and isinstance(data, dict): return data
    if c in (401, 403):                     # token REJEITADO (!= expirado) -> forca re-auth no proximo ciclo
        _auth["idtoken"] = None; _auth["exp"] = 0   # senao o robo ficava CEGO ate o token "expirar" (~58min)
    log("ERRO leitura KDS:", c, str(data)[:200]); return None

# ---------- CEREBRO: baixa e importa o etiqueta_saipos.py (parser maduro + IA). Fonte unica. ----------
ETQ = None
_ETQ_VER = None
def carrega_etiqueta():
    global ETQ, _ETQ_VER
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etiqueta_saipos.py")
    try:
        # baixa o cerebro do GitHub. Se o GitHub estiver fora/lixo, NAO trava: cai pro arquivo em disco.
        try:
            ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(ETIQUETA_URL, headers={"Cache-Control": "no-cache"})
            conteudo = urllib.request.urlopen(req, timeout=25, context=ctx).read().decode("utf-8")
            if len(conteudo) <= 2000 or "def extrair_itens_kds" not in conteudo:
                log("  cerebro baixado curto/invalido; mantenho o local em disco."); conteudo = None
            else:
                try: compile(conteudo, p, "exec")            # so troca se compilar (download truncado nao quebra)
                except SyntaxError as se: log("  cerebro baixado com sintaxe ruim; mantenho o local:", se); conteudo = None
            if conteudo:
                tmp = p + ".new"
                with open(tmp, "w", encoding="utf-8") as f: f.write(conteudo); f.flush(); os.fsync(f.fileno())
                os.replace(tmp, p)                            # troca ATOMICA (ou inteiro novo, ou inteiro velho)
        except Exception as e:
            if not os.path.exists(p):
                log("  ERRO baixando cerebro e SEM copia local:", e); return False
            log("  GitHub fora; uso o cerebro LOCAL em disco:", e)
        import importlib.util
        spec = importlib.util.spec_from_file_location("etiqueta_saipos", p)
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        if not (hasattr(m, "extrair_itens_kds") and hasattr(m, "agrupar_display") and hasattr(m, "aplicar_regras_display")):
            log("  ERRO: etiqueta sem extrair_itens_kds (versao antiga?)"); return False
        ETQ = m
        try: ETQ._carregar_regras()   # carrega o dicionario da IA (no-op se 'aplicar' desligado no servidor)
        except Exception: pass
        nova = getattr(m, "VERSION", "?")
        if nova != _ETQ_VER:          # so loga quando a versao do cerebro muda (evita spam a cada 5min)
            log(f"  cerebro da etiqueta carregado: v{nova} (antes v{_ETQ_VER}).")
            _ETQ_VER = nova
        return True
    except Exception as e:
        log("  ERRO carregando cerebro da etiqueta:", e); return False

# ---------- (legado: parser proprio do robo — NAO usado mais; montar_comanda usa o cerebro da etiqueta) ----------
def _norm(s): return (s or "").strip()
BEB = ["caneca","refri","coca","pepsi","guaran","fanta","sprite","del valle","kombucha","bally","pureza",
       "antarctica","tonica","agua","água","lata","refrigerante","chopp","cerveja","heineken","brahma","skol",
       "budweiser","stella","corona","eisenbahn","therez","original 600","long neck","vinho","taca","taça",
       "tinto","casillero","chandon","trivento","espumante","prosecco","caip","gin ","drink","suco","energetico",
       "red bull","monster","jarra","copo","open ","refil"]
DOCES = ["nutella","leite cond","brigadeiro","sensa","charge","prestigio","prestígio","morango","ovomaltine",
         "oreo","ninho","ferrero","kitkat","kit kat","beijinho","cartola","sonho de valsa","cocada","romeu",
         "confete","chocolate","banana","doce"]
def _low(s):
    s = (s or "").lower()
    for a,b in [("á","a"),("à","a"),("â","a"),("ã","a"),("é","e"),("ê","e"),("í","i"),("ó","o"),("ô","o"),("õ","o"),("ú","u"),("ç","c")]:
        s = s.replace(a,b)
    return s
def eh_bebida(n): x=_low(n); return any(b in x for b in [_low(z) for z in BEB])
def eh_doce(n): x=_low(n); return any(d in x for d in [_low(z) for z in DOCES])
def eh_adicional(n): return "adicional" in _low(n)
def eh_borda(n): return _low(n).replace("com ","").strip().startswith("borda")
def sem_borda(n): return "sem borda" in _low(n)
def eh_doce_broto(n): return "pizza broto de" in _low(n)
def slots(nome):
    n=_low(nome)
    if "gigante" in n: return 3
    if "grande" in n: return 2
    if "broto" in n: return 1
    return 0
def tira_prefixo(s): import re; return re.sub(r'^\s*\d+\s*[ªºoa°]\s*pizza\s*','',s or '',flags=re.I).strip()
def tira_fracao(s): import re; return re.sub(r'^\s*\d+\s*/\s*\d+\s+','',s or '').strip()
def limpa_broto(s): import re; m=re.sub(r'^.*?pizza\s+broto\s+de\s+','Broto de ',s or '',flags=re.I).strip(); return m or (s or '').strip()
def limpa_adicional(s): import re; return re.sub(r'^adicional\s*(de\s+)?','',tira_prefixo(s),flags=re.I).strip() or (s or '').strip()
def consolida(arr, denom):
    a=[x.strip() for x in arr if x and x.strip()]
    if not a: return []
    order=[]; cnt={}
    for s in a:
        if s not in cnt: order.append(s); cnt[s]=0
        cnt[s]+=1
    total = denom if denom and denom>0 else len(a)
    if len(order)==1: return [f"{total}/{total} {order[0]}"]
    return [f"{cnt[s]}/{total} {s}" for s in order]

# ---------- COMBO "Nx Pizza..." (carro-chefe) -> divide em N pizzas separadas ----------
def _tira_marcador(s):  # tira "# #"/"**" das pontas (Saipos embrulha o nome do combo nisso)
    s = re.sub(r'^[\s#*]+', '', s or '')
    s = re.sub(r'[\s#*]+$', '', s)
    return s.strip()
def conta_pizzas(nome):  # "# # 2 X Pizza Grande SALAO # #" -> 2
    m = re.match(r'^\s*(\d+)\s*x\s+', _low(_tira_marcador(nome)))
    return int(m.group(1)) if m else 1
def nome_sem_combo(nome):  # tira "# #", "Nx ", "+ Refrigerante" e o sufixo "Salao" -> "Pizza Grande"
    n = _tira_marcador(nome)
    n = re.sub(r'^\s*\d+\s*x\s+', '', n, flags=re.I)
    n = re.sub(r'\s*\+\s*(refrigerante|refri|coca|pureza|bebida).*$', '', n, flags=re.I)
    n = re.sub(r'\s+sal[aã]o\b.*$', '', n, flags=re.I)
    return n.strip()
def marcador_pizza(t):  # "1ª Pizza 1/2 Calabresa" -> (1, "1/2 Calabresa")
    m = re.match(r'^\s*(\d+)\s*[ªºoa°.]*\s*pizza\s+(.+)$', (t or '').strip(), re.I)
    if m: return int(m.group(1)), m.group(2).strip()
    return None, t

def traduzir_combo(desc, choices, out, refs):
    """Combo 'Nx Pizza ...' com marcadores 'Nª Pizza': divide em N pizzas separadas (cada uma com
    seus sabores + sua borda). Bebida/doce do combo vao pros refs (compartilhado). Espelha a etiqueta
    v177. Devolve True se achou marcador (e tratou); False = combo sem marcador -> usa o fluxo normal."""
    base = nome_sem_combo(desc) or "Pizza"
    sl = slots(base)
    pizzas = {}; ordem = []; cur = None; achou = False
    def _pizza(o):
        if o not in pizzas: pizzas[o] = {"flav":[], "adic":[], "borda":None}; ordem.append(o)
        return pizzas[o]
    for c in choices:
        c=_norm(c)
        if not c: continue
        ordn, resto = marcador_pizza(c)
        if ordn is not None:
            achou=True; cur=ordn; _pizza(ordn); cc=resto
        else:
            cc=c
        if sem_borda(cc): continue
        if eh_bebida(cc): refs.append({"tipo":"bebida","nome":cc,"qty":1,"sabores":[]}); continue
        if eh_doce_broto(cc): refs.append({"tipo":"caixa_doce","nome":limpa_broto(cc),"qty":1,"sabores":[]}); continue
        if cur is None: cur=1; _pizza(1)   # sabor/borda sem marcador antes do 1o "Nª Pizza" -> pizza 1
        alvo = pizzas[cur]
        if eh_borda(cc): alvo["borda"]=cc; continue
        if eh_doce(cc): refs.append({"tipo":"caixa_doce","nome":tira_fracao(tira_prefixo(cc)),"qty":1,"sabores":[]}); continue
        if eh_adicional(cc): alvo["adic"].append(limpa_adicional(cc)); continue
        alvo["flav"].append(tira_fracao(tira_prefixo(cc)))
    if not achou: return False
    for o in ordem:
        p = pizzas[o]
        sab = consolida(p["flav"], sl)
        for a in p["adic"]: sab.append("Adicional de "+a)
        out.append({"tipo":"caixa_salgada","nome":base,"qty":1,"sabores":sab})
        if p["borda"]:
            nb = re.sub(r'^\s*com\s+', '', tira_prefixo(p["borda"]), flags=re.I)
            out.append({"tipo":"borda","nome":nb,"qty":1,"sabores":[]})
    return True

def traduzir_item(desc, qty, choices, notes, out, refs):
    """Espelha parseStructuredItems: 1 item Saipos -> entradas de display."""
    desc=_norm(desc); qty=max(1,int(qty or 1)); low=_low(desc)
    if "pizza" in low:
        if conta_pizzas(desc) > 1 and not eh_doce_broto(desc) and traduzir_combo(desc, choices, out, refs):
            pass   # combo "Nx Pizza" dividido em N pizzas separadas
        elif eh_doce_broto(desc):
            out.append({"tipo":"caixa_doce","nome":limpa_broto(desc),"qty":qty,"sabores":[]})
        else:
            sl=slots(desc); flav=[]; adic=[]; borda=None
            for c in choices:
                c=_norm(c)
                if sem_borda(c): continue
                if eh_borda(c): borda=c; continue
                if eh_bebida(c): refs.append({"tipo":"bebida","nome":c,"qty":1,"sabores":[]}); continue
                if eh_doce_broto(c): refs.append({"tipo":"caixa_doce","nome":limpa_broto(c),"qty":1,"sabores":[]}); continue
                if eh_doce(c): refs.append({"tipo":"caixa_doce","nome":tira_fracao(tira_prefixo(c)),"qty":1,"sabores":[]}); continue
                if eh_adicional(c): adic.append(limpa_adicional(c)); continue
                flav.append(tira_fracao(tira_prefixo(c)))
            real=flav
            if sl>0 and len(flav)>sl:
                real=flav[:sl]
                for ex in flav[sl:]: refs.append({"tipo":"outro","nome":ex,"qty":1,"sabores":[]})
            doce = "doce" in low
            if real or borda or not choices:
                sab=consolida(real, sl)
                for a in adic: sab.append("Adicional de "+a)
                out.append({"tipo":("caixa_doce" if doce else "caixa_salgada"),"nome":desc,"qty":qty,"sabores":sab})
                if borda: out.append({"tipo":"borda","nome":tira_prefixo(borda),"qty":1,"sabores":[]})
        if notes: out.append({"tipo":"outro","nome":f"Obs: {notes}","qty":1,"sabores":[]})
    elif eh_bebida(desc):
        refs.append({"tipo":"bebida","nome":desc,"qty":qty,"sabores":[]})
    else:
        achou=False
        for c in choices:
            if eh_bebida(c): refs.append({"tipo":"bebida","nome":_norm(c),"qty":1,"sabores":[]}); achou=True
        if not achou and desc: refs.append({"tipo":"outro","nome":desc,"qty":qty,"sabores":[]})

def montar_comanda(id_sale, grupos):
    """Junta os grupos ativos de um id_sale -> payload pro ingest-comanda.
    ITENS via o CEREBRO da etiqueta (extrair_itens_kds + agrupar_display + IA) = mesma estrutura/regras do papel."""
    cliente=""; numero=""; canal=""; tipo_saipos=None; mesa=None; tem_table=False; num_delivery=None
    for g in grupos:
        cliente = cliente or _norm(g.get("customerFirstName")) or _norm(g.get("desc_sale"))
        tipo_saipos = tipo_saipos or g.get("id_sale_type")
        # numero amigavel da entrega/retirada: campo confirmado nos pedidos reais = sale_number
        if not num_delivery and g.get("sale_number"): num_delivery = g.get("sale_number")
        to = g.get("table_order") or {}
        if to:
            tem_table=True
            mesa = mesa or (((to.get("table") or {}).get("desc_store_table")))
        canal = canal or (((g.get("partner") or {}).get("partner_sale") or {}).get("bgm_partner_sale") or "")
    # CEREBRO UNICO: o mesmo parser/regras/IA da etiqueta (sem parser paralelo)
    items = ETQ.aplicar_regras_display(ETQ.agrupar_display(ETQ.extrair_itens_kds(grupos)), "comanda")
    total_caixas = sum(1 for d in items if d["tipo"] in ("caixa_salgada","caixa_doce"))
    total_entrega = sum(1 for d in items if d["tipo"]!="borda")
    # id_sale_type: 1=ENTREGA, 2=RETIRADA, 3=SALAO (confirmado nos logs)
    order_type = {1: "ENTREGA", 2: "RETIRADA", 3: "SALAO"}.get(tipo_saipos) or ("SALAO" if tem_table else "ENTREGA")
    if order_type == "SALAO":
        numero = str(mesa) if mesa else str(id_sale)[-4:]
    else:
        numero = str(num_delivery) if num_delivery else str(id_sale)[-4:]
    return {
        "version":1, "id_sale":str(id_sale), "numero_pedido":numero, "order_type":order_type,
        "canal":canal, "codigo_canal":"", "cliente_nome":cliente, "pagamento_cat":"", "hora_pedido":"",
        "items":items, "total_caixas":total_caixas, "total_entrega":total_entrega, "label_printed":True,
        "source":"terminal",  # marca a FONTE (o servidor so aceita comanda da fonte oficial; etiqueta=pc)
        "kds_debug":_KDS_SNAP,  # DIAGNOSTICO temporario: todas as fichas vistas no KDS neste ciclo
        "_tipo_saipos":tipo_saipos, "_mesa":mesa,  # campos extras so pra log (servidor ignora)
    }

def ativo(g, agora_ms):
    if not isinstance(g, dict): return False
    exp = g.get("expires_at")
    if isinstance(exp,(int,float)) and exp < agora_ms: return False
    # tem pelo menos 1 item nao-deletado?
    itens = g.get("items") or {}
    it_iter = itens.values() if isinstance(itens, dict) else itens
    return any(isinstance(it,dict) and str(it.get("deleted","")).upper()!="Y" for it in it_iter)

_enviados = {}  # id_sale -> hash do conteudo ja mandado (evita reenviar igual)
_KDS_SNAP = []  # DIAGNOSTICO: ultimo snapshot das fichas do KDS (vai no payload p/ mapear ficha de broto separada)
def assinatura(payload):
    base = json.dumps(payload["items"], ensure_ascii=False, sort_keys=True)
    return hashlib.md5(base.encode("utf-8")).hexdigest()

# ---------- MEMORIA PERSISTENTE (sobrevive a restart/auto-update -> reinicio NAO duplica) ----------
_ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enviados.json")
def _salva_enviados():
    try:
        d = dict(list(_enviados.items())[-800:])  # cap pra nao crescer sem fim
        with open(_ENV_FILE, "w", encoding="utf-8") as f: json.dump(d, f)
    except Exception as e:
        log("erro salvando enviados:", e)
def _carrega_enviados():
    """Carrega o que ja foi enviado. Devolve True se o arquivo existia; False = primeira vez (cold start)."""
    try:
        if os.path.exists(_ENV_FILE):
            with open(_ENV_FILE, encoding="utf-8") as f: d = json.load(f)
            if isinstance(d, dict):
                for k, v in d.items(): _enviados[str(k)] = str(v)
            return True
    except Exception as e:
        log("erro lendo enviados:", e)
    return False
def adotar_estado_atual():
    """Cold start (sem arquivo de estado): ADOTA os pedidos que ja estao na tela como 'ja enviados'
    SEM reenviar -> um restart/cutover nao recria comanda do que ja foi feito. So pedido NOVO a partir daqui."""
    data = ler_kds()
    if not isinstance(data, dict): return
    agora_ms = time.time()*1000
    por_sale = {}
    for k, g in data.items():
        if not isinstance(g, dict) or not ativo(g, agora_ms): continue
        ids = g.get("id_sale")
        if ids: por_sale.setdefault(str(ids), []).append(g)
    n = 0
    for ids, grupos in por_sale.items():
        try:
            payload = montar_comanda(ids, grupos)
            if payload["total_caixas"] > 0:
                _enviados[ids] = assinatura(payload); n += 1
        except Exception: pass
    _salva_enviados()
    log(f"  COLD START: adotei {n} pedido(s) ja na tela como enviados (NAO reenvio). So pedidos novos a partir de agora.")

_falhas_montagem = {}   # id_sale -> nº de polls seguidos em que montar_comanda estourou (alerta no 3º)
def ciclo(primeira):
    data = ler_kds()
    if data is None: return
    agora_ms = time.time()*1000
    # agrupa grupos ativos por id_sale
    por_sale = {}
    tipos_vistos = {}
    global _KDS_SNAP; _snap = []
    for k, g in data.items():
        if not isinstance(g, dict): continue
        tipos_vistos[g.get("id_sale_type")] = tipos_vistos.get(g.get("id_sale_type"),0)+1
        try:  # DIAGNOSTICO (temporario): resumo de TODA ficha do KDS, p/ mapear fichas que nao agrupam (broto em estacao separada)
            _its = g.get("items") or {}; _itv = list(_its.values()) if isinstance(_its, dict) else (_its or [])
            _d = [str((it or {}).get("desc_sale_item",""))[:26] for it in _itv if isinstance(it, dict) and str(it.get("deleted","")).upper() != "Y"][:3]
            _tbl = ((g.get("table_order") or {}).get("table") or {}).get("desc_store_table")
            _snap.append({"k": str(k)[:18], "s": str(g.get("id_sale") or ""), "t": g.get("id_sale_type"), "a": 1 if ativo(g, agora_ms) else 0, "tbl": _tbl, "d": _d})
        except Exception: pass
        if not ativo(g, agora_ms): continue
        ids = g.get("id_sale")
        if not ids: continue
        por_sale.setdefault(str(ids), []).append(g)
    _KDS_SNAP = _snap[:60]
    log(f"KDS: {len(data)} grupos no banco | {len(por_sale)} pedidos ativos | tipos id_sale_type vistos: {tipos_vistos}")
    # MODO CONFERENCIA: mostra o "cru" dos pedidos ativos (1x cada), pra mapear os campos (cliente/numero/bairro)
    if not ENVIAR and not MODO_SOMBRA:
        for _ids, _grps in list(por_sale.items()):
            if _ids in _enviados: continue
            _t = _grps[0].get("id_sale_type")
            _fn = os.path.join(_LOGDIR, f"raw_tipo{_t}_{_ids}.json")
            try:
                with open(_fn, "w", encoding="utf-8") as _rf:
                    json.dump(_grps[0], _rf, ensure_ascii=False, indent=1)
            except Exception: pass
            log(f"  RAW salvo: raw_tipo{_t}_{_ids}.json | campos do topo: {list(_grps[0].keys())}")
    enviadas=0
    for ids, grupos in por_sale.items():
        try:
            payload = montar_comanda(ids, grupos)
            _falhas_montagem.pop(ids, None)   # montou: zera o contador
        except Exception as e:
            nf = _falhas_montagem.get(ids, 0) + 1; _falhas_montagem[ids] = nf
            # antes isso era silencioso e ETERNO (pulava o pedido todo poll). Agora escala o aviso pra
            # ficar visivel no log/tela do robo apos 3 polls seguidos falhando o MESMO pedido.
            if nf >= 3:
                g0 = grupos[0] if grupos else {}
                cli = _norm(g0.get("customerFirstName")) or _norm(g0.get("desc_sale")) or "?"
                num = str(g0.get("sale_number") or str(ids)[-4:])
                log(f"  ###### ATENCAO: pedido #{num} (id {ids}, cli={cli}) NAO MONTA ha {nf} ciclos -> CONFERIR NO SAIPOS. erro: {e}")
            else:
                log("  erro montando", ids, e)
            continue
        if payload["total_caixas"]<=0: continue
        sig = assinatura(payload)
        if _enviados.get(ids)==sig: continue  # ja mandei igual
        resumo = f"#{payload['numero_pedido']} {payload['order_type']} cli={payload['cliente_nome']} mesa={payload.get('_mesa')} tipoSaipos={payload.get('_tipo_saipos')} | caixas={payload['total_caixas']} | itens=" + str([(d['tipo'][:3], d['nome'][:22], d.get('sabores')) for d in payload['items']][:6])
        if MODO_SOMBRA:
            p = {k:v for k,v in payload.items() if not k.startswith("_")}
            p["mesa"] = payload.get("_mesa"); p["tipo_saipos"] = payload.get("_tipo_saipos")
            c, body = _http(SHADOW_ENDPOINT, "POST", p)
            if 200 <= c < 300:
                _enviados[ids]=sig; enviadas+=1; log("  SOMBRA ok", resumo, "->", c)
            else:
                log("  SOMBRA FALHOU", c, str(body)[:140], "|", resumo)
        elif ENVIAR:
            p = {k:v for k,v in payload.items() if not k.startswith("_")}
            c, body = _http(COMANDA_ENDPOINT, "POST", p)
            if 200 <= c < 300:
                _enviados[ids]=sig; enviadas+=1; log("  ENVIADA", resumo, "->", c)
            else:
                log("  FALHOU", c, str(body)[:120], "|", resumo)
        else:
            _enviados[ids]=sig
            log("  [CONFERENCIA - nao enviei] MANDARIA:", resumo)
    if enviadas:
        _salva_enviados()
    if primeira and not ENVIAR:
        log("=== MODO CONFERENCIA: nada foi enviado. Confira os pedidos acima e mande o log pro assistente. ===")

# ---------- SENHA (de fora do arquivo, pra nao ir pro GitHub) ----------
def carrega_senha():
    global SENHA
    if SENHA: return
    env = os.environ.get("SAIPOS_SENHA")
    if env: SENHA = env.strip(); return
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "senha.txt")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f: SENHA = f.read().strip()
    except Exception as e:
        log("erro lendo senha.txt:", e)

# ---------- AUTO-UPDATE (igual a etiqueta: baixa do GitHub e se reinicia) ----------
def check_update():
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE   # PC Windows antigo as vezes falha no certificado
        req = urllib.request.Request(UPDATE_URL, headers={"Cache-Control": "no-cache"})
        resp = urllib.request.urlopen(req, timeout=8, context=ctx)
        conteudo = resp.read().decode("utf-8")
        m = re.search(r'^VERSION\s*=\s*["\'](\d+)["\']', conteudo, re.MULTILINE)
        if m:
            remote = int(m.group(1)); local = int(VERSION)
            if remote > local:
                # so troca se o download veio INTEIRO e compila (download truncado nao pode brickar o robo)
                if len(conteudo) <= 2000:
                    log("  Update abortado: download curto/incompleto."); return
                try: compile(conteudo, "<update>", "exec")
                except SyntaxError as se: log("  Update abortado: sintaxe ruim no download:", se); return
                log(f"  UPDATE: v{local} -> v{remote} (baixando e reiniciando)")
                path = os.path.abspath(__file__); tmp = path + ".new"
                with open(tmp, "w", encoding="utf-8") as f: f.write(conteudo); f.flush(); os.fsync(f.fileno())
                os.replace(tmp, path)   # troca ATOMICA: ou o arquivo antigo inteiro, ou o novo inteiro
                os.execv(sys.executable, [sys.executable] + sys.argv)
            else:
                log(f"  Versao v{VERSION} (atualizada)")
    except Exception as e:
        log(f"  Update: {e}")

def main():
    log("================= TERMINAL KDS -> CO LOVE =================")
    log("versao do terminal: v" + VERSION)
    log("ENVIAR =", ENVIAR, "(False = so confere | True = manda pra cozinha)")
    carrega_senha()
    if not SENHA:
        log("X  Falta a SENHA: crie um arquivo 'senha.txt' nesta pasta com a senha do terminalimpressoras@saipos.com."); return
    check_update()
    # carrega o CEREBRO (etiqueta) antes de tudo — sem ele nao da pra montar comanda
    while not carrega_etiqueta():
        log("  cerebro nao carregou; tento de novo em 15s..."); time.sleep(15)
    if _carrega_enviados():
        log(f"  memoria carregada: {len(_enviados)} pedidos ja enviados (nao reenvio no restart).")
    else:
        adotar_estado_atual()   # primeira vez: nao reenvia o que ja esta na tela
    primeira=True; loops=0
    passo_update = max(1, int(UPDATE_EVERY // POLL_SEG)) if UPDATE_EVERY > 0 else 0
    while True:
        try:
            ciclo(primeira); primeira=False
        except Exception as e:
            log("erro no ciclo:", type(e).__name__, e)
        loops += 1
        if passo_update and loops % passo_update == 0:
            check_update()              # atualiza o terminal_kds.py (reinicia so se a VERSION mudou)
            carrega_etiqueta()          # RECARREGA o cerebro (etiqueta_saipos.py): pega correcoes do parser
                                        # sem reiniciar o robo. Falha de download mantem o cerebro anterior.
                                        # (ja refresca o dicionario da IA por dentro.)
        time.sleep(POLL_SEG)

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: log("encerrado pelo usuario")
