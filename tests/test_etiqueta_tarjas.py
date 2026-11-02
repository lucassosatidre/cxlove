"""As tarjas da caixa precisam terminar antes do corte da etiqueta 100x100."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import ImageDraw, ImageChops, Image

spec = importlib.util.spec_from_file_location('etiqueta_tarjas', Path(__file__).resolve().parents[1] / 'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Tarjas(unittest.TestCase):
    def test_pagamento_e_pedido_inteiros_com_margem_antes_do_corte(self):
        original = ImageDraw.ImageDraw.text
        for pagamento, dados in [('PAGO_ONLINE', {}), ('DINHEIRO', {'valor': 180}), ('MISTO', {'resumo': 'DINHEIRO + CARTAO - CONFIRMAR PAGAMENTO'})]:
            for hora in ['19:46', '']:
                caixas = []
                def texto(draw, xy, text, *args, **kwargs):
                    if kwargs.get('fill') == 'white':
                        caixas.append(draw.textbbox(xy, text, font=kwargs.get('font')))
                    return original(draw, xy, text, *args, **kwargs)
                with patch.object(ImageDraw.ImageDraw, 'text', texto):
                    img = mod.gerar_etiqueta('49', 2, 2,
                        [{'tipo': 'caixa_salgada', 'nome': 'Pizza Gigante', 'qty': 1, 'sabores': ['Calabresa']},
                         {'tipo': 'bebida', 'nome': 'Coca Cola Zero 1,5l', 'qty': 1}],
                        3, pagamento, dados, False, 'IFOOD', '0412', '', hora, qr_texto='EQXYXNXYT87P', unitario=True)
                self.assertEqual(img.size, (mod.LARGURA_PX, mod.ALTURA_PX))
                self.assertTrue(caixas)
                limite = mod.ALTURA_PX - mod.ETIQ_MARGEM_INFERIOR_PX
                self.assertTrue(all(0 <= bb[1] < bb[3] <= limite for bb in caixas), caixas)
                margem = img.crop((0, limite + 1, img.width, img.height))
                self.assertIsNone(ImageChops.difference(margem, Image.new('RGB', margem.size, 'white')).getbbox())
                # A margem foi reservada no desenho, sem cortar ou encolher a imagem pronta.
                self.assertLessEqual(max(bb[3] for bb in caixas), limite - 2)


if __name__ == '__main__':
    unittest.main()
