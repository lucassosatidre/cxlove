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


if __name__ == "__main__":
    unittest.main()
