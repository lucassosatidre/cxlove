"""Compensacao da L42PRO no envio direto, sem cortes nem reamostragem."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location(
    'etiqueta_centralizacao', Path(__file__).resolve().parents[1] / 'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Centralizacao(unittest.TestCase):
    def test_desloca_campo_inteiro_e_preserva_bitmap_na_impressora_das_caixas(self):
        img = mod.gerar_etiqueta('47', 1, 1,
            [{'tipo': 'caixa_salgada', 'nome': 'Pizza Grande', 'qty': 1,
              'sabores': ['1/2 Havaiana', '1/2 3 Queijos']}],
            1, 'PAGO_ONLINE', {}, False, 'IFOOD', '8567', '', '21:58',
            qr_texto='EQXYXNXYT87P', unitario=True)
        original = img.tobytes()
        mono = img.convert('L').point(lambda p: 255 if p < 180 else 0, mode='1')
        for ip, desloc in [('192.168.1.14', 24), ('192.168.1.24', 0)]:
            with self.subTest(ip=ip), patch('socket.create_connection') as conectar, patch.object(mod, 'log'):
                mod._imprimir_caixa_direto(img, ip)
                conectar.assert_called_once_with((ip, 9100), timeout=8)
                zpl = conectar.return_value.__enter__.return_value.sendall.call_args.args[0].decode('ascii')
                self.assertIn(f'^PW{img.width}\n^LL{img.height}\n^LH0,0\n^FO{desloc},0^GFA,', zpl)
                bitmap = zpl.split('^GFA,', 1)[1].split('^FS', 1)[0].split(',', 3)
                self.assertEqual(int(bitmap[2]), (img.width + 7) // 8)
                self.assertEqual(bytes.fromhex(bitmap[3]), mono.tobytes())
                # Toda a tinta continua na largura fisica, inclusive o QR.
                self.assertLessEqual(mono.getbbox()[2] + desloc, img.width)
                self.assertEqual(img.tobytes(), original)

    def test_recusa_enviar_se_algum_conteudo_fosse_cortado(self):
        img = Image.new('RGB', (mod.LARGURA_PX, mod.ALTURA_PX), 'white')
        img.putpixel((img.width - 1, 10), (0, 0, 0))
        with patch('socket.create_connection') as conectar:
            with self.assertRaisesRegex(RuntimeError, 'nao cortar conteudo'):
                mod._imprimir_caixa_direto(img, '192.168.1.14')
            conectar.assert_not_called()


if __name__ == '__main__':
    unittest.main()
