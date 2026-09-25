"""v217: reimpressao de UMA etiqueta pedida no Mana + etiqueta de mesa com contraste invertido."""
import importlib.util
import pathlib
import unittest

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos_reimp", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

# pedido REAL #125 (Brendi, 25/09) como esta na sofia_print_queue: 3 etiquetas com QR + bebida
PEDIDO_125 = {
    "id": "fila-teste", "numero": "125", "canal": "Brendi", "tipo": "delivery", "total": 0,
    "forma_pagamento": "online", "hora": "2026-09-25T23:48:41Z",
    "itens": [
        {"qr": ["EQ7BG0WF2T1W"], "qtd": 1, "nome": "Pizza Grande", "tipo": "pizza", "borda": None,
         "sabores": [{"nome": "Calabresa com Cebola", "fracao": "1/2"}, {"nome": "Camarão", "fracao": "1/2"}], "categoria": "salgada"},
        {"qr": ["EQ56NFXQKB1A"], "qtd": 1, "nome": "Pizza Grande", "tipo": "pizza", "borda": None,
         "sabores": [{"nome": "Camarão com Catupiry", "fracao": "1/2"}, {"nome": "Strogonoff de Alcatra", "fracao": "1/2"}], "categoria": "salgada"},
        {"qr": ["EQY581538XCP"], "qtd": 1, "nome": "Pizza Broto", "tipo": "pizza", "borda": None,
         "sabores": [{"nome": "Nutella com Morango", "fracao": "1/1"}], "categoria": "doce"},
        {"qtd": 1, "nome": "Coca Cola Zero 1,5l", "tipo": "bebida"},
    ],
}


class ReimpressaoTest(unittest.TestCase):
    def setUp(self):
        self.etiquetas = []; self.producao = []; self.cupons = []
        self._orig = (MOD.gerar_etiqueta, MOD.imprimir_etiqueta, MOD.imprimir_etiqueta_producao, MOD._nome_por_ip,
                      MOD._instalar_impressora_24, MOD.time.sleep, MOD._impressora_para, MOD.sofia_evento)
        def ger(numero, i, n, display_i, *a, **k):
            self.etiquetas.append((i, n, k.get("qr_texto"))); return "img"
        MOD.gerar_etiqueta = ger
        MOD.imprimir_etiqueta = lambda img, printer_name=None, **k: (self.cupons.append(printer_name) if img != "img" else None) or True
        MOD.imprimir_etiqueta_producao = lambda img, imp, copias=1: self.producao.append(img)
        MOD._nome_por_ip = lambda ip: "producao 24" if ip == MOD.IP_IMPRESSORA_PRODUCAO else None
        MOD._instalar_impressora_24 = lambda: None
        MOD.time.sleep = lambda s: None
        MOD._impressora_para = lambda *a, **k: None
        MOD.sofia_evento = lambda *a, **k: None

    def tearDown(self):
        (MOD.gerar_etiqueta, MOD.imprimir_etiqueta, MOD.imprimir_etiqueta_producao, MOD._nome_por_ip,
         MOD._instalar_impressora_24, MOD.time.sleep, MOD._impressora_para, MOD.sofia_evento) = self._orig

    def test_reimpressao_so_da_pizza_pedida_mantem_numeracao(self):
        p = dict(PEDIDO_125, reimpressao=True, so_qr=["EQ56NFXQKB1A"])
        self.assertTrue(MOD.processar_sofia_pedido(p, "caixas 14"))
        self.assertEqual(self.etiquetas, [(2, 3, "EQ56NFXQKB1A")])
        self.assertEqual(self.cupons, [])       # reimpressao nao solta cupom

    def test_reimpressao_sem_so_qr_sai_todas(self):
        self.assertTrue(MOD.processar_sofia_pedido(dict(PEDIDO_125, reimpressao=True), "caixas 14"))
        self.assertEqual([e[0] for e in self.etiquetas], [1, 2, 3])

    def test_so_qr_que_nao_bate_imprime_todas(self):
        self.assertTrue(MOD.processar_sofia_pedido(dict(PEDIDO_125, reimpressao=True, so_qr=["EQXXXXXXXXXX"]), "caixas 14"))
        self.assertEqual(len(self.etiquetas), 3)

    def test_so_qr_ignorado_fora_de_reimpressao(self):
        MOD.processar_sofia_pedido(dict(PEDIDO_125, so_qr=["EQ56NFXQKB1A"]), "caixas 14")
        self.assertEqual(len(self.etiquetas), 3)

    def test_mesa_reimpressao_imprime_na_producao(self):
        p = {"id": "x", "formato": "mesa", "tipo": "salao", "numero": "38", "mesa": "38", "reimpressao": True,
             "pizza_seq": 2, "pizza_total": 2, "received_at": "2026-09-25T23:47:53Z",
             "itens": [{"nome": "Pizza Gigante", "qty": 1, "tipo": "caixa_salgada",
                        "sabores": ["1/3 Brócolis", "1/3 Calabresa com Cebola", "1/3 Portuguesa"]}]}
        self.assertTrue(MOD.processar_sofia_pedido(p, "caixas 14"))
        self.assertEqual(len(self.producao), 1)
        self.assertEqual(self.etiquetas, [])

    def test_mesa_reimpressao_sem_impressora_devolve(self):
        MOD._nome_por_ip = lambda ip: None
        p = {"id": "x", "formato": "mesa", "numero": "38", "reimpressao": True,
             "itens": [{"nome": "Pizza Broto", "qty": 1, "tipo": "caixa_doce", "sabores": ["Nutella"]}]}
        self.assertFalse(MOD.processar_sofia_pedido(p, "caixas 14"))

    def test_mesa_sem_reimpressao_continua_sem_imprimir(self):
        p = {"id": "x", "formato": "mesa", "numero": "38",
             "itens": [{"nome": "Pizza Broto", "qty": 1, "tipo": "caixa_doce", "sabores": ["Nutella"]}]}
        self.assertTrue(MOD.processar_sofia_pedido(p, "caixas 14"))
        self.assertEqual(self.producao, [])


class MesaInvertidaTest(unittest.TestCase):
    def test_fundo_preto_letra_branca(self):
        display = [{"tipo": "caixa_salgada", "nome": "Pizza Grande", "qty": 1, "sabores": ["2/2 Calabresa com Cebola"]}]
        img = MOD.gerar_etiqueta_mesa("113", display, 1, 1, hora="20:47").convert("L")
        px = list(img.getdata())
        pretos = sum(1 for p in px if p == 0) / len(px)
        self.assertTrue(set(px) <= {0, 255})          # 1 bit, sem cinza
        self.assertGreater(pretos, 0.6)               # fundo preto
        self.assertLess(pretos, 0.97)                 # tem letra branca
        self.assertEqual(img.getpixel((0, 0)), 0)
        self.assertEqual(img.getpixel((img.width - 1, img.height - 1)), 0)


if __name__ == "__main__":
    unittest.main()
