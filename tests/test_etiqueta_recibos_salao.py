import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
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
  with patch('socket.create_connection') as conexao,patch.object(mod,'log'),patch.object(mod.time,'sleep'):
   mod.salao_processar_recibo({'tipo':'bebidas','destino':'copa','cliente':'Mesa 1 · LC',
    'itens':[{'nome':'Coca-Cola','qty':1},{'tipo':'obs','nome':'Coca-Cola: 1 copo'}]})
   conexao.assert_called_once_with(('192.168.1.250',9100),timeout=8)
   sock=conexao.return_value.__enter__.return_value
   blocos=[c.args[0] for c in sock.sendall.call_args_list]
   self.assertEqual(blocos[0],b'\x1b@')
   self.assertEqual(blocos[-1],b'\n\n\n\x1bm')
   self.assertTrue(all(b.startswith(b'\x1d*') and b.endswith(b'\x1d/\x00') for b in blocos[1:-1]))
   self.assertTrue(all(len(b) < 2048 for b in blocos))
   self.assertEqual(sum(b.count(b'\x1bm') for b in (blocos[0],blocos[-1])),1)
   sock.shutdown.assert_called_once()
 def test_copa_blocos_preservam_todos_os_pixels_e_acentos(self):
  # Decodificador independente do protocolo compara a imagem inteira, incluindo
  # passagem entre faixas e os ultimos pontos de uma altura nao multipla de oito.
  pedido={'tipo':'bebidas','titulo':'COPA — Menezes','cliente':'Mesa 47 · LC',
    'itens':[{'tipo':'bebida','nome':'Guaraná Antárctica 350ml','qty':1},
             {'tipo':'obs','nome':'Guaraná: 2 copos · com gelo · sem limão'}]}
  original=mod.salao_resumo_img(pedido).convert('L')
  reconstruida=mod.Image.new('1',(576,((original.height+7)//8)*8),255)
  y=0
  for bloco in list(mod.salao_copa_blocos(original))[1:-1]:
   self.assertEqual(bloco[:2],b'\x1d*')
   largura,grupos=bloco[2:4]
   self.assertEqual(largura,72)
   self.assertLessEqual(largura*grupos,1536)
   self.assertEqual(len(bloco),4+largura*grupos*8+3)
   self.assertEqual(bloco[-3:],b'\x1d/\x00')
   for i,valor in enumerate(bloco[4:-3]):
    x=i//grupos
    for bit in range(8):
     reconstruida.putpixel((x,y+(i%grupos)*8+bit),0 if valor & (128>>bit) else 255)
   y+=grupos*8
  alvo=original.point(lambda p:255 if p>=155 else 0,mode='1')
  self.assertIsNone(ImageChops.difference(alvo,reconstruida.crop((0,0,576,original.height))).getbbox())
 def test_copa_bits_em_ordem_vertical_e_padding_branco(self):
  img=mod.Image.new('L',(576,25),255)
  for ponto in [(0,0),(0,7),(0,8),(575,23),(3,24)]: img.putpixel(ponto,0)
  blocos=list(mod.salao_copa_blocos(img))
  self.assertEqual(blocos[1][4:7],bytes((129,128,0)))
  self.assertEqual(blocos[1][4+575*3:7+575*3],bytes((0,0,1)))
  self.assertEqual(blocos[2][2:4],bytes((72,1)))
  self.assertEqual(blocos[2][4+3],128)
 def test_copa_falha_no_envio_nao_registra_sucesso(self):
  with patch('socket.create_connection') as conexao,patch.object(mod,'sofia_evento') as evento,patch.object(mod.time,'sleep'):
   conexao.return_value.__enter__.return_value.sendall.side_effect=[None,OSError('conexao interrompida')]
   with self.assertRaises(OSError): mod.salao_processar_recibo({'tipo':'bebidas','destino':'copa','itens':[]})
   evento.assert_not_called()
 def test_copa_destaca_mesa_produto_e_copos_sem_cortar(self):
  pedido={'tipo':'bebidas','titulo':'COPA — Menezes','cliente':'Mesa 1 · LC','hora':'2026-10-16T16:20:00',
   'itens':[{'tipo':'bebida','nome':'Kombucha Abacaxi com Hibisco 350ml','qty':1},
            {'tipo':'obs','nome':'Kombucha Abacaxi com Hibisco 350ml: 1 copo'}]}
  img=mod.salao_resumo_img(pedido)
  self.assertEqual(img.width,576)
  self.assertGreater(img.height,210)
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],560)
 def test_resumo_caixa(self):
  with patch('socket.create_connection') as conexao,patch.object(mod,'log'),patch.object(mod.time,'sleep'):
   mod.salao_processar_recibo({'tipo':'resumo','destino':'caixa_salao','total':100,'servico':True})
   conexao.assert_called_once_with(('192.168.1.168',9100),timeout=8)
   blocos=[c.args[0] for c in conexao.return_value.__enter__.return_value.sendall.call_args_list]
   self.assertEqual(blocos[0],b'\x1b@')
   self.assertTrue(all(len(b)<2048 for b in blocos))
   self.assertEqual(blocos[-1],b'\n\n\n\x1bm')
 def test_fiscal_do_salao_usa_destino_certo_blocos_pequenos_e_um_corte(self):
  img=mod.Image.new('RGB',(576,1450),'white')
  d=mod.ImageDraw.Draw(img);d.text((16,16),'DANFE NFC-e',fill='black');d.rectangle((200,1100,400,1300),fill='black')
  with patch('socket.create_connection') as conexao,patch.object(mod,'salao_fiscal_img',return_value=img),patch.object(mod.time,'sleep') as dormir,patch.object(mod,'log'):
   mod.salao_processar_recibo({'tipo':'fiscal','destino':'caixa_salao','id':'teste-fiscal','url':'fixture'})
   conexao.assert_called_once_with(('192.168.1.168',9100),timeout=8)
   sock=conexao.return_value.__enter__.return_value
   blocos=[c.args[0] for c in sock.sendall.call_args_list]
   self.assertEqual(blocos[0],b'\x1b@')
   self.assertTrue(all(len(b)<2048 for b in blocos))
   self.assertEqual(blocos[-1],b'\n\n\n\x1bm')
   self.assertEqual(len(blocos),((1450+23)//24)+2)
   self.assertEqual(dormir.call_count,len(blocos)-1)
   sock.shutdown.assert_called_once()
 def test_fiscal_falha_de_transporte_nao_registra_sucesso(self):
  with patch('socket.create_connection') as conexao,patch.object(mod,'salao_fiscal_img',return_value=mod.Image.new('RGB',(576,1500),'white')),patch.object(mod,'sofia_evento') as evento,patch.object(mod.time,'sleep'):
   conexao.return_value.__enter__.return_value.sendall.side_effect=[None,OSError('offline')]
   with self.assertRaises(OSError):mod.salao_processar_recibo({'tipo':'fiscal','destino':'caixa_salao','url':'fixture'})
   evento.assert_not_called()
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
 def test_poll_rapido_apos_comanda_da_copa(self):
  with TemporaryDirectory() as pasta, patch.object(mod,'PASTA_FILA',pasta), \
       patch.object(mod,'_sofia_config',return_value={'url':'https://exemplo.invalid','secret':'teste'}), \
       patch.object(mod,'_ip_responde',return_value=True), \
       patch.object(mod,'_sofia_http',side_effect=[{'pedidos':[{'id':'teste','destino':'copa','tipo':'bebidas'}]},{}]) as http, \
       patch.object(mod,'salao_processar_recibo') as imprimir, \
       patch.object(mod.time,'sleep',side_effect=StopIteration) as dormir:
   with self.assertRaises(StopIteration):mod.salao_recibos_poll_loop()
   imprimir.assert_called_once()
   self.assertEqual(http.call_count,2)
   self.assertEqual(http.call_args.kwargs['body'],{'action':'mark','ids':['teste']})
   dormir.assert_called_once_with(1)
 def test_poll_ocioso_mantem_intervalo_normal(self):
  with TemporaryDirectory() as pasta, patch.object(mod,'PASTA_FILA',pasta), \
       patch.object(mod,'_sofia_config',return_value={'url':'https://exemplo.invalid','secret':'teste'}), \
       patch.object(mod,'_ip_responde',return_value=True), \
       patch.object(mod,'_sofia_http',return_value={'pedidos':[]}), \
       patch.object(mod.time,'sleep',side_effect=StopIteration) as dormir:
   with self.assertRaises(StopIteration):mod.salao_recibos_poll_loop()
   dormir.assert_called_once_with(5)

if __name__=='__main__': unittest.main()
