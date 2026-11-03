import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import ImageChops, ImageDraw

spec = importlib.util.spec_from_file_location('consumo_legivel', Path(__file__).resolve().parents[1] / 'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PEDIDO = {'tipo':'resumo','titulo':'CONSUMO DA MESA — NÃO FISCAL','cliente':'Mesa 49 · 1 comanda(s)',
 'hora':'2026-11-03T02:19:00Z','consumo':168.33,'consumo_pago':0,'total':168.33,'servico':True,
 'itens':[{'tipo':'obs','nome':'COMANDA: MESA-49-33'},
 {'tipo':'pizza','nome':'Pizza Broto Doce (Aniversário)','qty':1,'sabores':['Sensação Ao Leite'],'preco_total':0},
 {'tipo':'obs','nome':'Aniversário'},
 {'tipo':'bebida','nome':'Coca Cola Zero 350ml','qty':3,'preco_total':30},
 {'tipo':'obs','nome':'Coca Cola Zero 350ml: Copos: 1'},
 {'tipo':'bebida','nome':'Macrovita de laranja - 300ml','qty':2,'preco_total':24},
 {'tipo':'pizza','nome':'Pizza Gigante','qty':1,'preco_total':107.33,
  'sabores':['1/3 Calabresa com Cebola','1/3 Frango Especial 2.0','1/3 Muçarela com Milho']},
 {'tipo':'obs','nome':'Favor não fazer essa pizza'},
 {'tipo':'bebida','nome':'Água sem Gás 500ml','qty':1,'preco_total':7}]}

class Consumo(unittest.TestCase):
 def test_blocos_preservam_itens_e_separam_observacoes(self):
  blocos=mod.salao_consumo_blocos(PEDIDO)
  self.assertEqual(sum(t=='produto' for t,_ in blocos),5)
  self.assertEqual(sum(t=='separador' for t,_ in blocos),7)
  pos=blocos.index(('produto','3x Coca Cola Zero 350ml'))
  self.assertEqual(blocos[pos+1:pos+3],[('valor','R$ 30,00'),('observacao','Coca Cola Zero 350ml: Copos: 1')])
  self.assertIn(('total','A PAGAR: R$ 185,16'),blocos)
  self.assertIn(('subtotal','Serviço (10%): R$ 16,83'),blocos)
 def test_fontes_maiores_e_todo_texto_cabe_no_papel(self):
  original=ImageDraw.ImageDraw.text
  textos=[]
  def texto(draw,xy,text,*args,**kwargs):
   font=kwargs['font'];bb=draw.textbbox(xy,text,font=font)
   textos.append((text,font.size,bb))
   return original(draw,xy,text,*args,**kwargs)
  with patch.object(ImageDraw.ImageDraw,'text',texto):
   img=mod.salao_resumo_img(PEDIDO)
  self.assertEqual(img.width,576)
  self.assertTrue(any('Coca Cola' in t and s==38 for t,s,_ in textos))
  self.assertTrue(any(t=='R$ 30,00' and s==32 for t,s,_ in textos))
  self.assertTrue(any(t.startswith('A PAGAR') and s==42 for t,s,_ in textos))
  self.assertTrue(all(16<=b[0] and b[2]<=560 and 0<=b[1]<b[3]<img.height for _,_,b in textos))
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],561)
 def test_nao_exibe_cancelado_e_nao_recalcula_preco_do_item(self):
  p={**PEDIDO,'itens':[{'tipo':'bebida','nome':'Cancelado','cancelado':True,'preco_total':99},
    {'tipo':'bebida','nome':'Água','qty':2,'preco_total':14,'pago':True}], 'total':0,'servico':False}
  blocos=mod.salao_consumo_blocos(p)
  self.assertIn(('produto','PAGO · 2x Água'),blocos)
  self.assertIn(('valor','R$ 14,00'),blocos)
  self.assertNotIn('Cancelado',str(blocos))
  self.assertIn(('total','A PAGAR: R$ 0,00'),blocos)
 def test_nome_sem_espacos_nao_vaza_da_largura(self):
  p={**PEDIDO,'itens':[{'tipo':'bebida','nome':'ProdutoMuitoLongo'*20,'qty':1,'preco_total':10}]}
  img=mod.salao_resumo_img(p)
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],561)

if __name__=='__main__': unittest.main()
