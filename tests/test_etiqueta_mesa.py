"""v214/v215: etiqueta de MESA (salao) — 1 comanda do Mana = 1 etiqueta 50x25, sem pagamento."""
import importlib.util
import base64
import json
import pathlib
import unittest
from urllib.parse import urlparse

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos_mesa", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

# linhas REAIS de comandas do Mana (mesa 64 de 25/09: combo "Gigante + Broto" que o papel embaralhava)
PENDENTES = [
    {"comanda_id": "16dc9fe9-b5a8-4b12-b0f7-2681ff9f7878", "id_sale": "881612263", "mesa": "64", "cliente_nome": "Consumidor",
     "hora_pedido": "", "pizza_seq": 1, "pizza_total": 2, "received_at": "2026-09-25T22:22:56.053665+00:00",
     "items": [{"nome": "Pizza Gigante", "qty": 1, "sabores": ["3/3 Americana"], "tipo": "caixa_salgada"}]},
    {"comanda_id": "261dbb82-1ebb-4a3e-bd44-1d06e0fbedb9", "id_sale": "881612263", "mesa": "64", "cliente_nome": "Consumidor",
     "hora_pedido": "", "pizza_seq": 2, "pizza_total": 2, "received_at": "2026-09-25T22:22:56.053665+00:00",
     "items": [{"nome": "Pizza Broto", "qty": 1, "sabores": ["Chocolate Preto"], "tipo": "caixa_doce"}]},
    {"comanda_id": "ff675d75-51b1-497e-8cae-90dae5f375c4", "id_sale": "881584777", "mesa": "43", "cliente_nome": "Consumidor",
     "hora_pedido": "", "pizza_seq": 1, "pizza_total": 1, "received_at": "2026-09-25T22:15:51.786772+00:00",
     "items": [{"nome": "Pizza Gigante", "qty": 1, "sabores": ["1/3 Calabresa com Catupiry", "1/3 Calabresa com Cebola", "1/3 4 Queijos"], "tipo": "caixa_salgada"},
               {"nome": "Água com Gás 500ml", "qty": 1, "sabores": [], "tipo": "bebida"}]},
]


class EtiquetaMesaTest(unittest.TestCase):
    def setUp(self):
        self.chamadas = []; self.rpcs = []
        self._orig = (MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep, MOD._mana_rpc, MOD._instalar_impressora_24)
        MOD._nome_por_ip = lambda ip: "producao 24 (etiquetas)" if ip == MOD.IP_IMPRESSORA_PRODUCAO else None
        MOD.imprimir_etiqueta_producao = lambda img, imp, copias=1: self.chamadas.append((imp, img.size))
        MOD.time.sleep = lambda s: None
        MOD._instalar_impressora_24 = lambda: None
        def rpc(nome, body=None, timeout=8):
            self.rpcs.append((nome, body))
            if nome == "etiqueta_mesa_reivindicar": return body["p_comanda"] != "ja-pego"
            return None
        MOD._mana_rpc = rpc

    def tearDown(self):
        MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep, MOD._mana_rpc, MOD._instalar_impressora_24 = self._orig

    def test_uma_comanda_do_mana_uma_etiqueta_na_24(self):
        imp = MOD.mesa_processar_pendentes(PENDENTES, "PC-TESTE")
        self.assertEqual(imp, 3)
        self.assertEqual(len(self.chamadas), 3)                       # gigante 64, broto 64, gigante 43 (bebida nao vira etiqueta)
        self.assertTrue(all(c[0] == "producao 24 (etiquetas)" and c[1] == (MOD.CO_LOVE_LARGURA_PX, MOD.CO_LOVE_ALTURA_PX) for c in self.chamadas))
        reiv = [b["p_comanda"] for n, b in self.rpcs if n == "etiqueta_mesa_reivindicar"]
        self.assertEqual(reiv, [p["comanda_id"] for p in PENDENTES])  # reivindica ANTES de imprimir, cada uma
        self.assertFalse(any(n == "etiqueta_mesa_devolver" for n, _ in self.rpcs))

    def test_comanda_pendente_de_antes_do_boot_tambem_imprime(self):
        imp = MOD.mesa_processar_pendentes(PENDENTES[:1], "PC-TESTE")
        self.assertEqual(imp, 1)
        self.assertEqual(len(self.chamadas), 1)
        self.assertFalse(any(b["p_pc"].endswith("/adotada") for n, b in self.rpcs if n == "etiqueta_mesa_reivindicar"))

    def test_chave_publica_pertence_ao_projeto_consultado(self):
        payload = MOD.MANA_ANON.split(".")[1]
        dados = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        self.assertEqual(urlparse(MOD.MANA_URL).hostname.split(".")[0], dados["ref"])

    def test_outro_pc_ja_pegou_nao_imprime(self):
        p = [dict(PENDENTES[0], comanda_id="ja-pego")]
        self.assertEqual(MOD.mesa_processar_pendentes(p, "PC-TESTE"), 0)
        self.assertEqual(self.chamadas, [])

    def test_sem_impressora_devolve_pra_fila(self):
        MOD._nome_por_ip = lambda ip: None
        imp = MOD.mesa_processar_pendentes(PENDENTES[:1], "PC-TESTE")
        self.assertEqual(imp, 0)
        self.assertEqual([b["p_comanda"] for n, b in self.rpcs if n == "etiqueta_mesa_devolver"], [PENDENTES[0]["comanda_id"]])

    def test_desenho_usa_seq_total_do_mana(self):
        d = MOD.mesa_display_do_mana(PENDENTES[1]["items"])
        uni = MOD.etiquetas_mesa_unidades(d)
        self.assertEqual(len(uni), 1)
        self.assertEqual(MOD._mesa_nome_produto(uni[0][0][0]), "PIZZA BROTO")
        img = MOD.gerar_etiqueta_mesa("64", uni[0][0], 2, 2, hora="19:22")
        self.assertEqual(img.size, (MOD.CO_LOVE_LARGURA_PX, MOD.CO_LOVE_ALTURA_PX))

    def test_texto_da_mesa_e_pote(self):
        self.assertEqual(MOD._mesa_txt("64"), "MESA 64")
        self.assertEqual(MOD._mesa_txt("Mesa: 18.01"), "MESA 18")
        self.assertEqual(MOD._mesa_nome_produto({"tipo": "dip", "nome": "Borda Dip Catupiry"}), "POTE DIP CATUPIRY")
        self.assertEqual(MOD._mesa_hora("2026-09-25T22:22:56.053665+00:00"), "19:22")

    def test_saipos_e_provisao_nao_imprimem_mais_mesa(self):
        self.assertTrue(MOD.processar_sofia_mesa({"numero": "1", "tipo": "salao", "itens": [{"qtd": 1, "nome": "Pizza Grande", "tipo": "pizza"}]}))
        self.assertEqual(self.chamadas, [])
        self.assertTrue(MOD._sofia_eh_mesa({"tipo": "salao"}))


if __name__ == "__main__":
    unittest.main()


class TestEtiquetaMesaQR(unittest.TestCase):
    """v218: QR da mesa = mesmo codigo que o Mana calcula (etiqueta_mesa_qr) e desenho com QR."""

    def test_codigo_igual_ao_do_mana(self):
        # valor conferido no banco do Mana em 26/09: etiqueta_mesa_qr('cc407c4b-...') = EQ12ECF6B9AC
        self.assertEqual(MOD.etiqueta_mesa_qr("cc407c4b-01ad-4d1b-ad41-20667ae65062"), "EQ12ECF6B9AC")
        self.assertIsNone(MOD.etiqueta_mesa_qr(None))

    def test_desenha_com_e_sem_qr(self):
        item = [{"nome": "Pizza Gigante", "qty": 1, "tipo": "caixa_salgada",
                 "sabores": ["1/3 Calabresa c/ Catupiry", "1/3 Calabresa c/ Cebola", "1/3 4 Queijos"]}]
        com = MOD.gerar_etiqueta_mesa("64", item, 1, 2, hora="19:22", qr="EQ12ECF6B9AC")
        sem = MOD.gerar_etiqueta_mesa("64", item, 1, 2, hora="19:22")
        self.assertEqual(com.size, (MOD.CO_LOVE_LARGURA_PX, MOD.CO_LOVE_ALTURA_PX))
        # canto de baixo a esquerda: branco (quadro do QR) so quando tem QR
        px = (MOD.QR_BORDA_ESQ_PX + 2, MOD.CO_LOVE_ALTURA_PX - MOD.MESA_QR_BORDA_INF_PX - 2)
        self.assertEqual(com.getpixel(px), (255, 255, 255))
        self.assertEqual(sem.getpixel(px), (0, 0, 0))


# v222: mesa 10 de 29/09/26 15:17, itens REAIS como o Maná devolve em etiqueta_mesa_pendentes
# (etiqueta_mesa_decorar conferida no banco numa transação desfeita). Antes: Gigante e Pote sem QR,
# e o Pote saiu "2/2" igual à Broto.
MESA10 = [
    {"comanda_id": "da804acb-0963-48a9-91ee-bb0d52310238", "id_sale": "x", "mesa": "10", "pizza_seq": 1, "pizza_total": 2,
     "received_at": "2026-09-29T18:17:40.01185+00:00", "etiqueta_qr": "EQ859739EEC9",
     "items": [{"qty": 1, "nome": "Pizza Gigante", "tipo": "caixa_salgada", "sabores": ["Americana", "+ Adicional de Catupiry"],
                "etiqueta_n": [1], "etiqueta_de": 3, "etiqueta_qr": "EQ859739EEC9"},
               {"qty": 1, "nome": "Borda Dip Catupiry", "tipo": "dip", "sabores": [],
                "etiqueta_n": [2], "etiqueta_de": 3, "etiqueta_tokens": ["EQ15CED7534D"]}]},
    {"comanda_id": "da5821e0-4c46-4018-88ed-ed4837c197fc", "id_sale": "x", "mesa": "10", "pizza_seq": 2, "pizza_total": 2,
     "received_at": "2026-09-29T18:17:40.01185+00:00", "etiqueta_qr": "EQ9CBB0209D5",
     "items": [{"qty": 1, "nome": "Pizza Broto", "tipo": "caixa_doce", "sabores": ["Chocolate Preto", "+ Adicional de Amendoim"],
                "etiqueta_n": [3], "etiqueta_de": 3, "etiqueta_qr": "EQ9CBB0209D5"}]},
]


class TestEtiquetaMesaPorItem(unittest.TestCase):
    def setUp(self):
        self.desenhos = []; self.rpcs = []
        self._orig = (MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep, MOD._mana_rpc,
                      MOD._instalar_impressora_24, MOD.gerar_etiqueta_mesa)
        MOD._nome_por_ip = lambda ip: "producao 24 (etiquetas)" if ip == MOD.IP_IMPRESSORA_PRODUCAO else None
        MOD.imprimir_etiqueta_producao = lambda img, imp, copias=1: None
        MOD.time.sleep = lambda s: None
        MOD._instalar_impressora_24 = lambda: None
        orig = MOD.gerar_etiqueta_mesa
        def desenha(mesa, display_i, idx, total, **kw):
            self.desenhos.append((MOD._mesa_nome_produto(display_i[0]), idx, total, kw.get("qr")))
            return orig(mesa, display_i, idx, total, **kw)
        MOD.gerar_etiqueta_mesa = desenha
        def rpc(nome, body=None, timeout=8):
            self.rpcs.append((nome, body)); return True if nome == "etiqueta_mesa_reivindicar" else None
        MOD._mana_rpc = rpc

    def tearDown(self):
        (MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep, MOD._mana_rpc,
         MOD._instalar_impressora_24, MOD.gerar_etiqueta_mesa) = self._orig

    def test_mesa10_cada_item_com_seu_qr_e_numero_da_mesa(self):
        self.assertEqual(MOD.mesa_processar_pendentes(MESA10, "PC-TESTE"), 3)
        self.assertEqual(self.desenhos, [
            ("PIZZA GIGANTE", 1, 3, "EQ859739EEC9"),
            ("POTE DIP CATUPIRY", 2, 3, "EQ15CED7534D"),
            ("PIZZA BROTO", 3, 3, "EQ9CBB0209D5"),
        ])
        reiv = [b for n, b in self.rpcs if n == "etiqueta_mesa_reivindicar"]
        self.assertTrue(all(b.get("p_por_item") is True for b in reiv))

    def test_qty_2_vira_duas_etiquetas_com_codigos_diferentes(self):
        itens = [{"qty": 2, "nome": "Borda Dip Cheddar", "tipo": "dip", "sabores": [],
                  "etiqueta_n": [4, 5], "etiqueta_de": 5, "etiqueta_tokens": ["EQAAAAAAAAA1", "EQAAAAAAAAA2"]}]
        MOD.imprimir_etiquetas_mesa("10", MOD.mesa_display_do_mana(itens))
        self.assertEqual([(d[1], d[2], d[3]) for d in self.desenhos], [(4, 5, "EQAAAAAAAAA1"), (5, 5, "EQAAAAAAAAA2")])

    def test_reimpressao_usa_os_codigos_gravados_na_comanda(self):
        ped = {"reimpressao": True, "mesa": "10", "itens": MESA10[0]["items"], "pizza_seq": 1, "pizza_total": 2,
               "received_at": MESA10[0]["received_at"], "reimpressao_comanda": MESA10[0]["comanda_id"]}
        self.assertTrue(MOD.processar_sofia_mesa(ped))
        self.assertEqual([(d[0], d[1], d[2], d[3]) for d in self.desenhos],
                         [("PIZZA GIGANTE", 1, 3, "EQ859739EEC9"), ("POTE DIP CATUPIRY", 2, 3, "EQ15CED7534D")])

    def test_comanda_antiga_sem_numeracao_segue_v221(self):
        itens = [{"qty": 1, "nome": "Pizza Gigante", "tipo": "caixa_salgada", "sabores": ["Americana"]},
                 {"qty": 1, "nome": "Borda Dip Catupiry", "tipo": "dip", "sabores": []}]
        MOD.imprimir_etiquetas_mesa("10", MOD.mesa_display_do_mana(itens), seq=1, total=2, qr="EQ859739EEC9")
        self.assertEqual([(d[1], d[2], d[3]) for d in self.desenhos], [(1, 2, None), (2, 2, None)])
