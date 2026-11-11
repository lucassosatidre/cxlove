import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ponte_ritmo', Path(__file__).resolve().parents[1] / 'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RitmoFilaTest(unittest.TestCase):
    def test_fila_vazia_reduz_chamadas_com_teto_de_cinco_segundos(self):
        ritmo = mod.RitmoFila()
        pausas = []
        for _ in range(10):
            ritmo.sucesso(False)
            pausas.append(ritmo.pausa())
        self.assertEqual(pausas[:4], [2, 3, 5, 5])
        self.assertEqual(max(pausas), 5)

    def test_lote_volta_para_um_segundo_e_depois_desacelera(self):
        with patch.object(mod.time, 'monotonic', return_value=100) as relogio:
            ritmo = mod.RitmoFila()
            for _ in range(5): ritmo.sucesso(False)
            ritmo.sucesso(True)
            self.assertEqual(ritmo.pausa(), 1)
            relogio.return_value = 114
            ritmo.sucesso(False)
            self.assertEqual(ritmo.pausa(), 1)
            relogio.return_value = 116
            self.assertEqual(ritmo.pausa(), 2)

    def test_rede_caida_tem_backoff_limitado_e_recuperacao(self):
        ritmo = mod.RitmoFila()
        pausas = []
        for _ in range(6):
            ritmo.falha()
            pausas.append(ritmo.pausa())
        self.assertEqual(pausas, [5, 10, 20, 30, 30, 30])
        ritmo.sucesso(True)
        self.assertEqual(ritmo.pausa(), 1)

    def test_etiquetas_mantem_cadencia_de_cinco_segundos_quando_ociosas(self):
        ritmo = mod.RitmoFila(normal=5)
        for _ in range(5):
            ritmo.sucesso(False)
            self.assertEqual(ritmo.pausa(), 5)

    def test_loop_do_salao_aplica_espera_sem_imprimir_nem_confirmar_fila_vazia(self):
        pausas = []
        def dormir(segundos):
            pausas.append(segundos)
            if len(pausas) == 4: raise StopIteration
        with TemporaryDirectory() as pasta, patch.object(mod, 'PASTA_FILA', pasta), \
             patch.object(mod, '_sofia_config', return_value={'url': 'https://example.invalid', 'secret': 'fixture'}), \
             patch.object(mod, '_ip_responde', return_value=True), \
             patch.object(mod, '_sofia_http', return_value={'pedidos': []}) as http, \
             patch.object(mod, 'salao_processar_recibo') as imprimir, \
             patch.object(mod.time, 'sleep', side_effect=dormir):
            with self.assertRaises(StopIteration): mod.salao_recibos_poll_loop()
        self.assertEqual(pausas, [2, 3, 5, 5])
        self.assertEqual(http.call_count, 4)
        self.assertTrue(all('method' not in call.kwargs for call in http.call_args_list))
        imprimir.assert_not_called()


if __name__ == '__main__': unittest.main()
