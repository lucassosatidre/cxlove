"""v206: a .14 (caixas) parou -> etiquetas das caixas vao pra .24 (producao), papel 80x30.

Testa a escolha da impressora sem Windows: finge quais impressoras o PC tem instaladas
(por IP) e quais respondem na porta 9100.
"""
import importlib.util
import pathlib
import unittest
import uuid

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"


def carregar(instaladas, vivas, modo="auto"):
    spec = importlib.util.spec_from_file_location(f"etq_{uuid.uuid4().hex}", ARQUIVO)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.CAIXAS_NA_PRODUCAO = modo
    m._achar_impressora_por_ip = lambda ip: instaladas.get(ip)
    m._ip_responde = lambda ip, **k: ip in vivas
    m.log = lambda *a, **k: None
    return m


C, P = "192.168.1.14", "192.168.1.24"
INST = {C: "caixas tele", P: "producao colove"}


class CaixasNaProducao(unittest.TestCase):
    def test_14_viva_fica_na_14(self):
        m = carregar(INST, {C, P})
        self.assertEqual(m._impressora_caixas(), "caixas tele")
        self.assertFalse(m._eh_impressora_producao("caixas tele"))

    def test_14_parada_vai_pra_24_e_forca_80x30(self):
        m = carregar(INST, {P})
        nome = m._impressora_caixas()
        self.assertEqual(nome, "producao colove")
        self.assertTrue(m._eh_impressora_producao(nome))

    def test_14_volta_sozinha(self):
        vivas = {P}
        m = carregar(INST, vivas)
        self.assertEqual(m._impressora_caixas(), "producao colove")
        vivas.add(C)
        self.assertEqual(m._impressora_caixas(), "caixas tele")

    def test_as_duas_paradas_mantem_antigo(self):
        m = carregar(INST, set())
        self.assertEqual(m._impressora_caixas(), "caixas tele")

    def test_pc_sem_14_mas_com_24_entra_na_fila(self):
        m = carregar({P: "producao colove"}, {P})
        self.assertEqual(m._impressora_caixas_deste_pc(), "producao colove")

    def test_pc_sem_14_e_24_parada_fica_fora(self):
        m = carregar({P: "producao colove"}, set())
        self.assertIsNone(m._impressora_caixas_deste_pc())

    def test_modo_sempre_e_nunca(self):
        self.assertEqual(carregar(INST, {C, P}, "sempre")._impressora_caixas(), "producao colove")
        self.assertEqual(carregar(INST, {P}, "nunca")._impressora_caixas(), "caixas tele")


if __name__ == "__main__":
    unittest.main()
