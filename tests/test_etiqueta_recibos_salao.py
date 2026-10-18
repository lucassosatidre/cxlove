import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
from PIL import ImageChops

spec = importlib.util.spec_from_file_location('ponte_salao',Path(__file__).resolve().parents[1]/'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Recibos(unittest.TestCase):
 def test_destinos_exatos(self):
  self.assertEqual(mod.SALAO_DESTINOS,{'copa':'192.168.1.250','caixa_salao':'192.168.1.168'})
 def test_nao_manda_bebida_caixa(self):
  with self.assertRaises(ValueError): mod.salao_processar_recibo({'tipo':'bebidas','destino':'caixa_salao'})
 def test_nao_manda_fiscal_copa(self):
  with self.assertRaises(ValueError): mod.salao_processar_recibo({'tipo':'fiscal','destino':'copa'})
 def test_bebida_envia_para_copa(self):
  with patch('socket.create_connection') as conexao,patch.object(mod,'log'):
   mod.salao_processar_recibo({'tipo':'bebidas','destino':'copa','cliente':'Mesa 1 · LC',
    'itens':[{'nome':'Coca-Cola','qty':1},{'tipo':'obs','nome':'Coca-Cola: 1 copo'}]})
   conexao.assert_called_once_with(('192.168.1.250',9100),timeout=8)
   dados=conexao.return_value.__enter__.return_value.sendall.call_args.args[0]
   self.assertTrue(dados.startswith(b'\x1b@'))
   self.assertIn(b'Mesa 1 - LC',dados)
   self.assertIn(b'1x Coca-Cola',dados)
   self.assertIn(b'Copos: 1',dados)
   self.assertIn(b'\x1b\x21\x38',dados)
   self.assertNotIn(b'\x1dv0',dados)
   self.assertNotIn(b'\x1d\xf9',dados)
   self.assertTrue(dados.endswith(b'\n\n\n\x1bm'))
 def test_copa_destaca_mesa_produto_e_copos_sem_cortar(self):
  pedido={'tipo':'bebidas','titulo':'COPA — Menezes','cliente':'Mesa 1 · LC','hora':'2026-10-16T16:20:00',
   'itens':[{'tipo':'bebida','nome':'Kombucha Abacaxi com Hibisco 350ml','qty':1},
            {'tipo':'obs','nome':'Kombucha Abacaxi com Hibisco 350ml: 1 copo'}]}
  img=mod.salao_resumo_img(pedido)
  self.assertEqual(img.width,576)
  self.assertGreater(img.height,210)
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],560)
 def test_resumo_caixa(self):
  with patch('socket.create_connection') as conexao,patch.object(mod,'log'):
   mod.salao_processar_recibo({'tipo':'resumo','destino':'caixa_salao','total':100,'servico':True})
   conexao.assert_called_once_with(('192.168.1.168',9100),timeout=8)
   dados=conexao.return_value.__enter__.return_value.sendall.call_args.args[0]
   self.assertTrue(dados.startswith(b'\x1dv0\x00'))
 def test_raster_largo_em_blocos(self):
  img = mod.Image.new('RGB',(576,600),'black');d=mod.salao_bitmap(img)
  self.assertEqual(d[:8],b'\x1dv0\x00\x48\x00\x00\x02')
  self.assertEqual(d[8],255)
  self.assertEqual(d[8+72*512:16+72*512],b'\x1dv0\x00\x48\x00\x58\x00')
  self.assertTrue(d.endswith(b'\n\n\n\x1bm'))
 def test_nao_fetch_url_arbitraria(self):
  with patch('urllib.request.urlopen') as fetch:
   with self.assertRaises(ValueError): mod.salao_fiscal_img('http://127.0.0.1/segredo')
   fetch.assert_not_called()
 def test_danfe_legivel_preserva_conteudo_e_qr(self):
  html='<html><head><style>body{font-size:8px}</style></head><body><div class="content"><canvas width="220"></canvas><span style="font-size: 10px;">Protocolo fiscal</span></div></body></html>'
  legivel=mod.salao_fiscal_html_legivel(html)
  self.assertEqual(legivel.count('id="provisao-danfe-legibilidade"'),1)
  self.assertLess(legivel.index('body{font-size:8px}'),legivel.index('id="provisao-danfe-legibilidade"'))
  self.assertIn('<canvas width="220"></canvas>',legivel)
  self.assertIn('Protocolo fiscal',legivel)
  self.assertIn('font-size: 15px !important',legivel)
 def test_falha_na_rede_nao_marcada_sucesso(self):
  with patch('socket.create_connection',side_effect=OSError('offline')):
   with self.assertRaises(OSError):mod.salao_processar_recibo({'tipo':'bebidas','destino':'copa','itens':[]})

if __name__=='__main__': unittest.main()
