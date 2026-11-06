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
    def test_margens_quatro_lados_qr_inteiro_e_numero_nas_duas_tarjas(self):
        lateral=round(3*mod.DPI/25.4);vertical=round(4*mod.DPI/25.4)
        tamanho_original=(mod.LARGURA_PX,mod.ALTURA_PX)
        textos=[];original=ImageDraw.ImageDraw.text
        def texto(draw,xy,text,*args,**kwargs):
            font=kwargs.get('font');bb=draw.textbbox(xy,text,font=font)
            textos.append((text,font.size,bb))
            return original(draw,xy,text,*args,**kwargs)
        for pagamento,dados,nome in [('PAGO_ONLINE',{},''),('DINHEIRO',{'valor':180},''),('MISTO',{'resumo':'DINHEIRO + CARTAO - CONFIRMAR PAGAMENTO'},''),('PAGO',{},'Cliente com nome de identificação bastante comprido')]:
            textos.clear()
            with patch.object(ImageDraw.ImageDraw,'text',texto):
                img=mod.gerar_etiqueta('20',1,2,
                    [{'tipo':'caixa_salgada','nome':'Pizza Gigante','qty':1,'sabores':['1/3 Havaiana','1/3 Bacon com Milho','1/3 Catuperu']},
                     {'tipo':'bebida','nome':'Guaraná Antarctica Zero 1,5l','qty':1}],
                    3,pagamento,dados,bool(nome),'IFOOD','9754',nome,'19:45',qr_texto='EQXYXNXYT87P',unitario=True)
            self.assertEqual(img.size,tamanho_original)
            for box in [(0,0,lateral,img.height),(img.width-lateral,0,img.width,img.height),(0,0,img.width,vertical),(0,img.height-vertical,img.width,img.height)]:
                regiao=img.crop(box)
                self.assertIsNone(ImageChops.difference(regiao,Image.new('RGB',regiao.size,'white')).getbbox())
            qr=mod.qr_imagem('EQXYXNXYT87P',modulo=mod.QR_MODULO_PX,margem=mod.QR_MARGEM_MOD).convert('RGB')
            x=lateral+mod.QR_BORDA_ESQ_PX;y=vertical+62+4
            self.assertIsNone(ImageChops.difference(img.crop((x,y,x+qr.width,y+qr.height)),qr).getbbox())
            self.assertEqual(sum(t=='#0020' for t,_,_ in textos),2)
            self.assertTrue(all(0<=b[0] and b[2]<=img.width-2*lateral and 0<=b[1] and b[3]<=img.height-vertical for _,_,b in textos),textos)
            if pagamento=='PAGO_ONLINE':
                self.assertEqual([s for t,s,_ in textos if t=='#0020'],[48,44])
                self.assertTrue(any('Havaiana' in t and s<=62 for t,s,_ in textos))
            self.assertEqual((mod.LARGURA_PX,mod.ALTURA_PX),tamanho_original)

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
