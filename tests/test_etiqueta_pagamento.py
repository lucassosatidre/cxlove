import importlib.util
import pathlib
import unittest


ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MOD)


class EtiquetaPagamentoTest(unittest.TestCase):
    def test_vale_alelo_aparece_com_valor_no_rodape(self):
        categoria, dados = MOD.sofia_pag_cat(
            "vale",
            None,
            123.39,
            pagamentos=[{"forma": "vale", "valor": 123.39, "online": False}],
            bandeira="ALELO",
        )
        rodape = MOD.montar_rodape_linha(3, categoria, dados)
        self.assertIn("VALE ALELO", rodape)
        self.assertIn("R$123,39", rodape)

    def test_payload_provisao_conta_dip_e_nao_cria_etiqueta_para_refri(self):
        display = MOD.sofia_display([
            {"tipo": "pizza", "nome": "Pizza Grande", "qtd": 1, "sabores": [{"fracao": "1/1", "nome": "Calabresa"}]},
            {"tipo": "dip", "nome": "Pote Dip Catupiry", "qtd": 1},
            {"tipo": "bebida", "nome": "Coca Cola 1,5l", "qtd": 1},
        ])
        self.assertEqual([item["tipo"] for item in display], ["caixa_salgada", "dip", "bebida"])
        total_caixas, total_dips, total_bebidas, total_outros, total_entrega, total_etiquetas = MOD.sofia_totais(display)
        self.assertEqual((total_caixas, total_dips, total_bebidas, total_outros), (1, 1, 1, 0))
        self.assertEqual(total_entrega, 3)
        self.assertEqual(total_etiquetas, 2)

        so_refri = MOD.sofia_display([{"tipo": "bebida", "nome": "Coca Cola 1,5l", "qtd": 1}])
        self.assertEqual(MOD.sofia_totais(so_refri)[-1], 0)


if __name__ == "__main__":
    unittest.main()
