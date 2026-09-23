"""v204: uma etiqueta por produto + QR embutido (sem biblioteca externa)."""
import importlib.util
import pathlib
import unittest

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos_unit", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

PEDIDO4 = [
    {"qtd": 1, "nome": "Pizza Gigante", "tipo": "pizza", "categoria": "salgada",
     "sabores": [{"nome": "Muçarela", "fracao": "1/1"}], "qr": ["EQXYXNXYT87P"]},
    {"qtd": 2, "nome": "Pizza Broto", "tipo": "pizza", "categoria": "doce",
     "sabores": [{"nome": "Nutella com Morango", "fracao": "1/1"}], "qr": ["EQ4SB1R448FE", "EQZXRGZQ7MCH"]},
    {"qtd": 1, "nome": "Pote Dip Cheddar", "tipo": "dip", "qr": ["EQFW0KD47C6V"]},
    {"qtd": 1, "nome": "Coca Cola 1,5l", "tipo": "bebida"},
    {"qtd": 1, "nome": "Obs: sem cebola", "tipo": "outro"},
]


class EtiquetaUnitariaTest(unittest.TestCase):
    def test_um_produto_por_etiqueta_bebida_e_obs_em_todas(self):
        uni = MOD.sofia_etiquetas_unitarias(MOD.sofia_display(PEDIDO4))
        self.assertEqual(len(uni), 4)                      # gigante + 2 brotos + pote
        principais = [d[0]["nome"] + "|" + ",".join(d[0]["sabores"]) for d, _ in uni]
        self.assertEqual(principais[0], "Pizza Gigante|Muçarela")
        self.assertEqual(principais[1], principais[2])     # 2x broto = 2 etiquetas de 1x
        self.assertTrue(all(d[0]["qty"] == 1 for d, _ in uni))
        for d, _ in uni:
            tipos = [x["tipo"] for x in d]
            self.assertIn("bebida", tipos)
            self.assertIn("obs", tipos)
            self.assertEqual(sum(1 for x in d if x["tipo"] in ("caixa_salgada", "caixa_doce", "dip")), 1)
        self.assertEqual([q for _, q in uni], ["EQXYXNXYT87P", "EQ4SB1R448FE", "EQZXRGZQ7MCH", "EQFW0KD47C6V"])

    def test_itens_do_rodape_continua_o_pedido_inteiro(self):
        display = MOD.sofia_display(PEDIDO4)
        *_, total_entrega, n_et = MOD.sofia_totais(display)
        self.assertEqual(n_et, 4)
        self.assertEqual(total_entrega, 5)                 # 1 + 2 + 1 dip + 1 bebida (obs não conta)

    def test_codigo_invalido_nao_vira_qr(self):
        d = MOD.sofia_display([{"qtd": 1, "nome": "Pizza Grande", "tipo": "pizza", "sabores": [], "qr": ["eq:/xx"]}])
        self.assertEqual(MOD.sofia_etiquetas_unitarias(d)[0][1], None)

    def test_sem_codigo_imprime_sem_qr(self):
        d = MOD.sofia_display([{"qtd": 1, "nome": "Pizza Grande", "tipo": "pizza", "sabores": []}])
        disp, qr = MOD.sofia_etiquetas_unitarias(d)[0]
        self.assertIsNone(qr)
        img = MOD.gerar_etiqueta("7", 1, 1, disp, 1, "PAGO", {}, False, "IFOOD", "123", "", "12:00",
                                 qr_texto=qr, unitario=True)
        self.assertEqual(img.size, (MOD.LARGURA_PX, MOD.ALTURA_PX))

    def test_etiqueta_com_qr_tem_o_tamanho_do_papel(self):
        d = MOD.sofia_display(PEDIDO4)
        disp, qr = MOD.sofia_etiquetas_unitarias(d)[0]
        img = MOD.gerar_etiqueta("4", 1, 4, disp, 5, "PAGO", {}, False, "IFOOD", "5251", "", "13:05",
                                 qr_texto=qr, unitario=True)
        self.assertEqual(img.size, (MOD.LARGURA_PX, MOD.ALTURA_PX))


class QrEmbutidoTest(unittest.TestCase):
    """Conferido contra a biblioteca oficial "qrcode" quando ela existe (no PC não precisa)."""

    def test_matriz_igual_a_biblioteca_oficial(self):
        try:
            import qrcode
            from qrcode.util import QRData
        except ImportError:
            self.skipTest("biblioteca qrcode ausente (só para conferência)")
        import random, string
        random.seed(7)
        casos = ["EQXYXNXYT87P", "EQ0000000000", "HELLO WORLD"] + [
            "".join(random.choice(string.digits + string.ascii_uppercase) for _ in range(random.randint(1, 50)))
            for _ in range(25)]
        for t in casos:
            v = (len(MOD.qr_matriz(t, 0)) - 17) // 4
            for mk in range(8):
                q = qrcode.QRCode(version=v, error_correction=qrcode.constants.ERROR_CORRECT_M, mask_pattern=mk, border=0)
                q.add_data(QRData(t)); q.make(fit=False)
                ref = [[1 if x else 0 for x in row] for row in q.get_matrix()]
                self.assertEqual(MOD.qr_matriz(t, mk), ref, f"{t} v{v} m{mk}")

    def test_codigo_da_etiqueta_cabe_na_menor_versao(self):
        self.assertEqual(len(MOD.qr_matriz("EQXYXNXYT87P")), 21)   # versão 1 = 21x21


if __name__ == "__main__":
    unittest.main()
