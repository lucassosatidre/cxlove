"""v214/v215: etiqueta de MESA (salao) — 1 comanda do Mana = 1 etiqueta 50x25, sem pagamento."""
import importlib.util
import pathlib
import time
import unittest

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
        imp, ado = MOD.mesa_processar_pendentes(PENDENTES, "PC-TESTE", inicio=0)
        self.assertEqual((imp, ado), (3, 0))
        self.assertEqual(len(self.chamadas), 3)                       # gigante 64, broto 64, gigante 43 (bebida nao vira etiqueta)
        self.assertTrue(all(c[0] == "producao 24 (etiquetas)" and c[1] == (MOD.CO_LOVE_LARGURA_PX, MOD.CO_LOVE_ALTURA_PX) for c in self.chamadas))
        reiv = [b["p_comanda"] for n, b in self.rpcs if n == "etiqueta_mesa_reivindicar"]
        self.assertEqual(reiv, [p["comanda_id"] for p in PENDENTES])  # reivindica ANTES de imprimir, cada uma
        self.assertFalse(any(n == "etiqueta_mesa_devolver" for n, _ in self.rpcs))

    def test_comanda_de_antes_do_boot_e_adotada_sem_imprimir(self):
        imp, ado = MOD.mesa_processar_pendentes(PENDENTES, "PC-TESTE", inicio=time.time())
        self.assertEqual((imp, ado), (0, 3))
        self.assertEqual(self.chamadas, [])
        self.assertTrue(all(b["p_pc"].endswith("/adotada") for n, b in self.rpcs if n == "etiqueta_mesa_reivindicar"))

    def test_outro_pc_ja_pegou_nao_imprime(self):
        p = [dict(PENDENTES[0], comanda_id="ja-pego")]
        self.assertEqual(MOD.mesa_processar_pendentes(p, "PC-TESTE", inicio=0), (0, 0))
        self.assertEqual(self.chamadas, [])

    def test_sem_impressora_devolve_pra_fila(self):
        MOD._nome_por_ip = lambda ip: None
        imp, ado = MOD.mesa_processar_pendentes(PENDENTES[:1], "PC-TESTE", inicio=0)
        self.assertEqual((imp, ado), (0, 0))
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
