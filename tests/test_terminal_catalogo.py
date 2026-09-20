import importlib.util
import pathlib
import tempfile
import unittest
from unittest import mock


ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "terminal_kds.py"
SPEC = importlib.util.spec_from_file_location("terminal_kds_catalogo", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MOD)


def catalogo(textos, codigos):
    return {
        "versao": 1,
        "por_texto": {f"t{i}": {} for i in range(textos)},
        "por_codigo": {str(i): {} for i in range(codigos)},
    }


class TerminalCatalogoTest(unittest.TestCase):
    def test_catalogo_legitimo_menor_que_100_e_aceito_sem_copia_anterior(self):
        ok, motivo = MOD.validar_catalogo_novo(catalogo(80, 500), None)
        self.assertTrue(ok, motivo)

    def test_queda_maior_que_30_porcento_e_rejeitada(self):
        ok, motivo = MOD.validar_catalogo_novo(catalogo(70, 500), catalogo(110, 792))
        self.assertFalse(ok)
        self.assertIn("queda", motivo.lower())

    def test_catalogo_antigo_continua_valido_quando_download_falha(self):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = pathlib.Path(pasta) / "catalogo_salao.json"
            caminho.write_text('{"versao":1,"por_texto":{"a":{}},"por_codigo":{"1":{}}}')
            with mock.patch.object(MOD.urllib.request, "urlopen", side_effect=OSError("sem rede")):
                self.assertTrue(MOD.catalogo_local_disponivel(str(caminho)))

    def test_alerta_critico_e_um_card_visivel_no_mana(self):
        payload = MOD.payload_alerta_catalogo("ausente")
        self.assertEqual(payload["numero_pedido"], "ALERTA")
        self.assertEqual(payload["cliente_nome"], "MONITOR KDS")
        self.assertEqual(payload["total_caixas"], 1)
        self.assertIn("COMANDAS PAUSADAS", payload["items"][0]["nome"])


if __name__ == "__main__":
    unittest.main()
