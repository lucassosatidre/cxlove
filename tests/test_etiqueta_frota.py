"""v202: vários PCs buscando a fila de etiquetas do Provisão ao mesmo tempo.

Cada PC é uma cópia separada do módulo (memória própria, como um PC de verdade)
rodando o sofia_poll_loop numa thread. A fila falsa imita a da nuvem:
reserva atômica, reserva vence (aqui em 0,5 s; na nuvem 2 min), mark e release.
"""
import importlib.util
import pathlib
import threading
import time
import unittest
import uuid

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
VENCE = 0.5


def carregar_pc():
    spec = importlib.util.spec_from_file_location(f"etiqueta_pc_{uuid.uuid4().hex}", ARQUIVO)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FilaFalsa:
    def __init__(self, n):
        self.lock = threading.Lock()
        self.itens = {}
        self.eventos = []
        self.pings = {}
        self.nuvem_fora = False
        for i in range(1, n + 1):
            pid = str(uuid.uuid4())
            self.itens[pid] = {"status": "pending", "claimed_at": 0, "claimed_by": None, "pedido": {
                "id": pid, "numero": str(i), "canal": "iFood", "tipo": "entrega",
                "hora": "2026-09-23T20:00:00Z", "total": 80, "forma_pagamento": "pago",
                "itens": [{"tipo": "pizza", "nome": "Pizza Grande", "qtd": 1, "categoria": "salgada",
                           "sabores": [{"nome": "Muçarela", "fracao": "1/1"}], "borda": None}],
            }}

    def http(self, pc):
        def _http(url, method="GET", body=None, secret="", pc=""):
            with self.lock:
                agora = time.time()
                if method == "GET":
                    out = []
                    for it in self.itens.values():
                        livre = it["status"] == "pending" or (
                            it["status"] == "printing" and it["claimed_at"] < agora - VENCE)
                        if livre:
                            it.update(status="printing", claimed_at=agora, claimed_by=pc)
                            out.append(dict(it["pedido"]))
                    return {"pedidos": out}
                ids = body.get("ids", [])
                if body.get("action") == "mark":
                    for pid in ids:
                        self.itens[pid]["status"] = "printed"
                        self.itens[pid]["printed_by"] = pc
                    return {"ok": True}
                if body.get("action") == "log":
                    if self.nuvem_fora:
                        raise OSError("sem internet")
                    for e in body.get("eventos", []):
                        self.eventos.append(dict(e, pc=pc))
                    return {"ok": True, "gravados": len(body.get("eventos", []))}
                if body.get("action") == "ping":
                    self.pings.setdefault(pc, []).append(body)
                    return {"ok": True}
                if body.get("action") == "release":
                    for pid in ids:
                        if self.itens[pid]["status"] == "printing":
                            self.itens[pid].update(status="pending", claimed_at=0)
                    return {"ok": True}
            raise AssertionError("chamada inesperada")
        return _http


class Frota:
    def __init__(self, fila):
        self.fila = fila
        self.impressas = []           # (pc, numero) de cada etiqueta que SAIU
        self.lock = threading.Lock()
        self.chamadas_fila = {}

    def ligar(self, pc, chave=True, impressora=True, modo="ok"):
        mod = carregar_pc()
        mod.SOFIA_POLL_INTERVAL = 0.01
        mod.SOFIA_PAUSA_APOS_FALHA = 0.3
        mod.log = lambda msg: None
        mod.check_update = lambda: None
        mod._nome_deste_pc = lambda: pc
        mod._sofia_config = (lambda: {"url": "https://fila", "secret": "x"}) if chave else (lambda: None)
        mod._impressora_caixas_deste_pc = (lambda: "ELGIN") if impressora else (lambda: None)
        http = self.fila.http(pc)

        def contar_http(url, method="GET", **k):
            if method == "GET":   # so reserva conta (log e ping sobem mesmo sem impressora)
                self.chamadas_fila[pc] = self.chamadas_fila.get(pc, 0) + 1
            return http(url, method=method, **k)
        mod._sofia_http = contar_http

        def imprimir(img, printer_name=None, larg=None, alt=None):
            if modo == "quebrada":
                return False
            if modo == "morre":
                threading.Event().wait()   # travou no meio e nunca volta
            with self.lock:
                self.impressas.append(pc)
            return True
        mod.imprimir_etiqueta = imprimir
        mod._impressora_para = lambda *a, **k: None   # sem impressora de cupom no teste
        threading.Thread(target=mod.sofia_poll_loop, daemon=True).start()

    def esperar(self, segundos=6):
        fim = time.time() + segundos
        while time.time() < fim:
            with self.fila.lock:
                if all(it["status"] == "printed" for it in self.fila.itens.values()):
                    return True
            time.sleep(0.05)
        return False


class FrotaEtiquetaTest(unittest.TestCase):
    def fila_pings(self, fila, pc):
        with fila.lock:
            return list(fila.pings.get(pc, []))

    def conferir_uma_vez_cada(self, fila, frota):
        with fila.lock:
            self.assertTrue(all(it["status"] == "printed" for it in fila.itens.values()))
        self.assertEqual(len(frota.impressas), len(fila.itens), "etiqueta repetida ou faltando")

    def test_tres_pcs_nenhuma_repetida(self):
        fila = FilaFalsa(40); frota = Frota(fila)
        for pc in ("CAIXA", "COZINHA-1", "COZINHA-2"):
            frota.ligar(pc)
        self.assertTrue(frota.esperar())
        self.conferir_uma_vez_cada(fila, frota)

    def test_impressora_quebrada_outro_pc_assume(self):
        fila = FilaFalsa(20); frota = Frota(fila)
        frota.ligar("QUEBRADO", modo="quebrada")
        time.sleep(0.2)                     # o quebrado pega primeiro, falha e devolve
        frota.ligar("BOM")
        self.assertTrue(frota.esperar())
        self.conferir_uma_vez_cada(fila, frota)
        self.assertNotIn("QUEBRADO", frota.impressas)
        with fila.lock:
            self.assertTrue(all(it["printed_by"] == "BOM" for it in fila.itens.values()))

    def test_pc_trava_no_meio_outro_pega_quando_vence(self):
        fila = FilaFalsa(10); frota = Frota(fila)
        frota.ligar("TRAVA", modo="morre")
        time.sleep(0.2)
        frota.ligar("BOM")
        self.assertTrue(frota.esperar())
        self.conferir_uma_vez_cada(fila, frota)

    def test_pc_sem_chave_ou_sem_impressora_nao_reserva(self):
        fila = FilaFalsa(5); frota = Frota(fila)
        frota.ligar("SEM-CHAVE", chave=False)
        frota.ligar("SEM-IMPRESSORA", impressora=False)
        time.sleep(0.5)
        self.assertEqual(frota.chamadas_fila.get("SEM-CHAVE", 0), 0)
        self.assertEqual(frota.chamadas_fila.get("SEM-IMPRESSORA", 0), 0)
        self.assertTrue(self.fila_pings(fila, "SEM-IMPRESSORA"), "PC sem impressora deve avisar que existe")
        self.assertFalse(self.fila_pings(fila, "SEM-CHAVE"), "sem chave nao fala com a nuvem")
        with fila.lock:
            self.assertTrue(all(it["status"] == "pending" for it in fila.itens.values()))
        frota.ligar("BOM")
        self.assertTrue(frota.esperar())
        self.conferir_uma_vez_cada(fila, frota)


class LogNaNuvemTest(unittest.TestCase):
    """v203: cada impressao vira evento na nuvem (etiqueta_impressao_log) + ping do PC."""

    def eventos(self, fila, pc=None, evento=None):
        with fila.lock:
            return [e for e in fila.eventos
                    if (pc is None or e["pc"] == pc) and (evento is None or e["evento"] == evento)]

    def esperar_eventos(self, fila, evento, n, segundos=4):
        fim = time.time() + segundos
        while time.time() < fim and len(self.eventos(fila, evento=evento)) < n:
            time.sleep(0.05)

    def test_cada_etiqueta_vira_evento_com_pc_e_pedido(self):
        fila = FilaFalsa(6); frota = Frota(fila)
        frota.ligar("CAIXA")
        self.assertTrue(frota.esperar())
        self.esperar_eventos(fila, "marcada", 6)
        ok = self.eventos(fila, evento="etiqueta_ok")
        self.assertEqual(len(ok), 6)
        self.assertEqual({e["numero"] for e in ok}, {str(i) for i in range(1, 7)})
        self.assertTrue(all(e["pc"] == "CAIXA" and e["versao"] and e["fila_id"] for e in ok))
        self.assertEqual(len(self.eventos(fila, evento="marcada")), 6)
        self.assertTrue(self.eventos(fila, evento="iniciou"))
        self.assertTrue(fila.pings.get("CAIXA"), "PC nao mandou o 'estou vivo'")

    def test_impressora_quebrada_aparece_no_log(self):
        fila = FilaFalsa(3); frota = Frota(fila)
        frota.ligar("QUEBRADO", modo="quebrada")
        self.esperar_eventos(fila, "devolvida", 3)
        self.assertTrue(self.eventos(fila, "QUEBRADO", "etiqueta_erro"))
        self.assertGreaterEqual(len(self.eventos(fila, "QUEBRADO", "devolvida")), 3)
        self.assertFalse(self.eventos(fila, "QUEBRADO", "etiqueta_ok"))

    def test_sem_internet_eventos_esperam_e_sobem_depois(self):
        fila = FilaFalsa(4); frota = Frota(fila)
        fila.nuvem_fora = True
        frota.ligar("CAIXA")
        self.assertTrue(frota.esperar())          # a impressao nao depende do log
        time.sleep(0.2)
        self.assertEqual(self.eventos(fila, evento="etiqueta_ok"), [])
        fila.nuvem_fora = False
        self.esperar_eventos(fila, "etiqueta_ok", 4)
        self.assertEqual(len(self.eventos(fila, evento="etiqueta_ok")), 4)


if __name__ == "__main__":
    unittest.main()
