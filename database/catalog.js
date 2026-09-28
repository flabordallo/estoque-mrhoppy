// Catálogo canônico migrado VERBATIM do app.js original (v1.11).
// Não editar à mão — origem única da migração de dados.

const RAW_ITEMS = `
SOS|Queijo mozzarela|4|unidade
SOS|Queijo Prato|1|unidade
SOS|Queijo Gorgonzola|2|unidade
SOS|Bisnaga Q. cheddar|4|unidade
SOS|Pepperoni|1|unidade
SOS|Bisnaga Catupiry|1|unidade
SOS|Creme de Leite|2|Caixa (com 12)
SOS|Óleo de Algodão|2|unidade
SOS|Pimenta do reino|1|unidade
SOS|Azeitona Fatiada|1|unidade
SOS|Perfex|1|unidade
SOS|Luva preta G|2|unidade
SOS|Luva preta M|2|unidade
SOS|Hambúrguer de Frango|30|unidade
SOS|Morango congelado|1|Caixa
SOS|Amora|1|unidade
SOS|Batata 7mm|24|unidade
SOS|Batata rústica|6|Unidade
SOS|Onion|6|unidade
SOS|Churros|2|unidade
SOS|Filé de tilápia|12|unidade
SOS|Dadinho de tapioca|12|unidade
SOS|Bacon em cubos|12|unidade
OESA|Queijo Gouda|6|unidade
OESA|Hambúrguer veg|24|unidade
OESA|Catchup Heinz|6|unidade
OESA|Maionese Heinz|6|unidade
OESA|Barbecue|4|unidade
OESA|Hellmann's Bisnaga|6|unidade
DIVERSOS|Gelo||unidade
DIVERSOS|Açúcar||unidade
DIVERSOS|Farinha||unidade
DIVERSOS|Sal||unidade
DIVERSOS|Canela||unidade
DIVERSOS|CO2|2|unidade
DIVERSOS|Growler||unidade
DIVERSOS|Limão||unidade
DIVERSOS|Laranja||unidade
DIVERSOS|Hortelã||unidade
DIVERSOS|Manjericão||unidade
DIVERSOS|Haus preto||unidade
DIVERSOS|Haus vermelho||unidade
DIVERSOS|Chicletes verde||unidade
DIVERSOS|Chicletes vermelho||unidade
DIVERSOS|Amendoim chinês||unidade
DIVERSOS|Amendoim torrado||unidade
PÃO|Pão Branco|1.5|Caixa
PÃO|Pão Brioche|1|Caixa
HAMBÚRGUER|Hambúrguer 120g|350|unidade
HAMBÚRGUER|Smash|150|unidade
HAMBÚRGUER|Hambúrguer Costela|40|unidade
HAMBÚRGUER|Hambúrguer Frango||unidade
P/FAZER|Bolinho Macaxeira||unidade
P/FAZER|Geleia Abacaxi||unidade
P/FAZER|Geleia Maçã||unidade
P/FAZER|Geleia Goiaba||unidade
P/FAZER|Quentão||unidade
COCA|Coca lata 350ml|15|unidade
COCA|Coca zero 350ml|20|unidade
COCA|Coca 200ml|5|unidade
COCA|Coca zero 200ml|4|unidade
COCA|Fanta Laranja|3|unidade
COCA|Guaraná|4|unidade
COCA|Fanta uva|3|unidade
COCA|Sprite|5|unidade
COCA|Água tônica|5|unidade
COCA|Água tônica zero|4|unidade
COCA|Schweppes citrus|5|unidade
COCA|Suco uva lata|3|unidade
COCA|Suco maracujá lata|3|unidade
COCA|Suco pêssego lata|3|unidade
COCA|Suco maracujá litro|1|caixa
COCA|Água com gás|15|unidade
COCA|Água sem gás|20|unidade
RED BULL|Red Bull Normal|4|Fardo
RED BULL|Red Bull Tropical|2|unidade
RED BULL|Red Bull Zero|2|unidade
RED BULL|Red Bull Melancia|1|unidade
DESTILADOS|Jack Normal|5|unidade
DESTILADOS|Jack Fire|4|unidade
DESTILADOS|Jack Honey|2|unidade
DESTILADOS|Jack Apple|2|unidade
DESTILADOS|Bacardi Ouro|10|unidade
DESTILADOS|Bacardi Branco|4|unidade
DESTILADOS|Jägermeister|4|unidade
DESTILADOS|Vodka Bacco|20|L
DESTILADOS|Velho Barreiro|6|unidade
DESTILADOS|Xarope Morango|4|unidade
DESTILADOS|Xarope Framboesa|2|unidade
DESTILADOS|Xarope Menta Verde|4|unidade
DESTILADOS|Tequila|3|unidade
DESTILADOS|Gin Hambre|6|unidade
DESTILADOS|Campari|2|unidade
DESTILADOS|Licor 43|2|unidade
CURITIBA|Comanda Lanche||unidade
CURITIBA|Comanda Drink||unidade
CURITIBA|Pimenta defumada|12|unidade
CURITIBA|Pimenta sweet|12|unidade
CONS. / EMBAL.|Água Sanitária|3|galão
CONS. / EMBAL.|Álcool 70|3|galão
CONS. / EMBAL.|Desinfetante|5|galão
CONS. / EMBAL.|Detergente Neutro|3|galão
CONS. / EMBAL.|Multiuso 500ml|6|unidade
CONS. / EMBAL.|Sabão em pó|2|kg
CONS. / EMBAL.|Sabão Líquido|1|galão
CONS. / EMBAL.|Saco lixo 150L|2|fardo
CONS. / EMBAL.|Saco lixo 60L|2|fardo
CONS. / EMBAL.|Toalha Papel cozinha|1|fardo
CONS. / EMBAL.|Sacola 30x40|1|caixa
CONS. / EMBAL.|Luva amarela|3|unidade
CONS. / EMBAL.|Sal sachê|1|caixa
CONS. / EMBAL.|Canudos refri|10|pacote
CONS. / EMBAL.|Canudos Drink|10|pacote
CONS. / EMBAL.|Copo 50ml|5|Pacotes
CONS. / EMBAL.|Pote 100ml|7|Pacotes
CONS. / EMBAL.|Toalha papel interfolhada||fardo
CONS. / EMBAL.|Esponja normal|10|unidade
CONS. / EMBAL.|Copo isopor 180ml|100|unidade
CONS. / EMBAL.|Toalha papel Banheiro|2|fardo
CONS. / EMBAL.|Papel higiênico rolo|3|fardo
CONS. / EMBAL.|Esponja Chapa|10|pacote
CONS. / EMBAL.|Limpa Chapa|2|unidade
CONS. / EMBAL.|Garfo Madeira|10|Pacotes
CONS. / EMBAL.|Touca cozinha|2|fardo
EMBALAGENS|Cx Porção Batata|6|unidade
EMBALAGENS|Saco Viagem|1|unidade
EMBALAGENS|Saco Viagem Batata|2|unidade
EMBALAGENS|Guardanapos|2|unidade
EMBALAGENS|Embalagem Hambúrguer|6|unidade
EMBALAGENS|Embalagem Porção|3|unidade
EMBALAGENS|Cx Porção|3|unidade
EMBALAGENS|Copo 440ml|10|caixa
EMBALAGENS|Copo 330ml|4|caixa
EMBALAGENS|Copo Dose|8|unidade
EMBALAGENS|Guardanapos novos|1|caixa
EMBALAGENS|Copo shot|12|unidade
EMBALAGENS|Copo caipira|1|Caixa
OUTROS|Bobina Máq Cartão|12|caixa
OUTROS|Bobina Imp. Fiscal|6|unidade
OUTROS|Canetas cx|10|unidade
OUTROS|Papel Impressora|1|unidade
OUTROS|Tinta Impressora|1|unidade
OUTROS|Caneta Verm Cozinha|6|unidade
OESA|MACAXEIRA|6|Unidade`;

const CHOPP = [["Curitiba", "Pilsen", 50, 10], ["Curitiba", "Weiss", 30, 1], ["Curitiba", "Vinho", 15, 1], ["Curitiba", "Gin", 70, 0], ["Curitiba", "Sour", 30, 1], ["Curitiba", "Paladina", 10, 0], ["Floripa", "Sem glúten", 90, 0], ["Floripa", "Lager", 90, 0], ["Floripa", "Juicy", 70, 0], ["Floripa", "Red", 10, 0], ["Floripa", "Stout", 10, 0], ["Floripa", "APA", 30, 0], ["Floripa", "Session", 0, 0], ["Floripa", "Double", 100, 0], ["Floripa", "Schornstein IPA", 100, 0]];

const LEVELS = [["Cheio", 100], ["Quase cheio", 90], ["Mais da metade", 70], ["Metade", 50], ["Menos da metade", 30], ["Quase acabando", 15], ["Acabando", 10], ["Acabou", 0]];

module.exports = { RAW_ITEMS, CHOPP, LEVELS };