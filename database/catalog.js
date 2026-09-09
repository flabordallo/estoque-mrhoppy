// Catálogo canônico migrado VERBATIM do app.js original (v1.11).
// Não editar à mão — origem única da migração de dados.

const RAW_ITEMS = `SOS|Queijo mozzarela||unidade
SOS|Queijo Prato||unidade
SOS|Queijo Gorgonzola||unidade
SOS|Bisnaga Q. cheddar||unidade
SOS|Pepperoni||unidade
SOS|Bisnaga Catupiry||unidade
SOS|Crème de Leite||unidade
SOS|Óleo de Algodão||unidade
SOS|Pimenta do reino||unidade
SOS|Azeitona Fatiada||unidade
SOS|Perfex||unidade
SOS|Luva preta G||unidade
SOS|Luva preta M||unidade
SOS|Hambúrguer de Frango||unidade
SOS|Morango congelado||unidade
SOS|Amora||unidade
SOS|Batata 7mm||unidade
SOS|Batata rústica||unidade
SOS|Onion||unidade
SOS|Churros||unidade
SOS|Filé de tilápia||unidade
SOS|Dadinho de tapioca||unidade
SOS|Bacon em cubos||unidade
OESA|Queijo Gouda||unidade
OESA|Hambúrguer veg||unidade
OESA|Catchup Heinz||unidade
OESA|Maionese Heinz||unidade
OESA|Barbecue||unidade
OESA|Hellmann's Bisnaga||unidade
DIVERSOS|Gelo||unidade
DIVERSOS|Açúcar||unidade
DIVERSOS|Farinha||unidade
DIVERSOS|Sal||unidade
DIVERSOS|Canela||unidade
DIVERSOS|CO2||unidade
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
PÃO|Pão Branco||unidade
PÃO|Pão Brioche||unidade
HAMBÚRGUER|Hambúrguer 120g||unidade
HAMBÚRGUER|Smash||unidade
HAMBÚRGUER|Hambúrguer Costela||unidade
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
RED BULL|Red Bull Normal||unidade
RED BULL|Red Bull Tropical||unidade
RED BULL|Red Bull Zero||unidade
RED BULL|Red Bull Melancia||unidade
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
DESTILADOS|Gin Bourlone|6|unidade
DESTILADOS|Campari|2|unidade
DESTILADOS|Licor 43||unidade
CURITIBA|Comanda Lanche||unidade
CURITIBA|Comanda Drink||unidade
CURITIBA|Pimenta defumada||unidade
CURITIBA|Pimenta sweet||unidade
CONS. / EMBAL.|Água Sanitária|3|galão
CONS. / EMBAL.|Álcool 70|3|galão
CONS. / EMBAL.|Desinfetante|5|galão
CONS. / EMBAL.|Detergente Neutro|3|galão
CONS. / EMBAL.|Multiuso 500ml|6|unidade
CONS. / EMBAL.|Sabão em pó|2|kg
CONS. / EMBAL.|Sabão Líquido|1|galão
CONS. / EMBAL.|Saco lixo 150L|2|fardo
CONS. / EMBAL.|Saco lixo 60L|2|fardo
CONS. / EMBAL.|Toalha Papel cozinha|2|fardo
CONS. / EMBAL.|Sacola 30x40|1|caixa
CONS. / EMBAL.|Luva amarela|3|unidade
CONS. / EMBAL.|Sal sachê|1|caixa
CONS. / EMBAL.|Canudos refri|10|pacote
CONS. / EMBAL.|Canudos Drink|10|pacote
CONS. / EMBAL.|Copo 50ml|1|caixa
CONS. / EMBAL.|Pote 100ml|1|caixa
CONS. / EMBAL.|Toalha papel interfolhada|0.5|fardo
CONS. / EMBAL.|Esponja cozinha|10|unidade
CONS. / EMBAL.|Copo isopor 180ml|100|unidade
CONS. / EMBAL.|Toalha papel Banheiro|2|fardo
CONS. / EMBAL.|Papel higiênico rolo|3|fardo
CONS. / EMBAL.|Esponja Chapa|10|pacote
CONS. / EMBAL.|Limpa Chapa|2|unidade
CONS. / EMBAL.|Garfo Madeira|1|caixa
CONS. / EMBAL.|Touca cozinha|2|fardo
EMBALAGENS|Cx Porção Batata|6|unidade
EMBALAGENS|Saco Viagem|3|unidade
EMBALAGENS|Saco Viagem Batata|2|unidade
EMBALAGENS|Guardanapos|4|unidade
EMBALAGENS|Embalagem Hambúrguer|6|unidade
EMBALAGENS|Embalagem Porção|3|unidade
EMBALAGENS|Cx Porção|3|unidade
EMBALAGENS|Copo 440ml|10|caixa
EMBALAGENS|Copo 330ml|4|caixa
EMBALAGENS|Copo Dose|12|unidade
EMBALAGENS|Guardanapos novos|1|caixa
EMBALAGENS|Copo shot|12|unidade
EMBALAGENS|Copo caipira|12|unidade
OUTROS|Bobina Máq Cartão|12|caixa
OUTROS|Bobina Imp. Fiscal|6|unidade
OUTROS|Canetas cx|10|unidade
OUTROS|Papel Impressora|1|unidade
OUTROS|Tinta Impressora|1|unidade
OUTROS|Caneta Verm Cozinha|6|unidade`;

const CHOPP = [["Curitiba", "Pilsen", 50, 10], ["Curitiba", "Weiss", 30, 1], ["Curitiba", "Vinho", 15, 1], ["Curitiba", "Gin", 70, 0], ["Curitiba", "Sour", 30, 1], ["Curitiba", "Paladina", 10, 0], ["Floripa", "Sem glúten", 90, 0], ["Floripa", "Lager", 90, 0], ["Floripa", "Juicy", 70, 0], ["Floripa", "Red", 10, 0], ["Floripa", "Stout", 10, 0], ["Floripa", "APA", 30, 0], ["Floripa", "Session", 0, 0], ["Floripa", "Double", 100, 0], ["Floripa", "Schornstein IPA", 100, 0]];

const LEVELS = [["Cheio", 100], ["Quase cheio", 90], ["Mais da metade", 70], ["Metade", 50], ["Menos da metade", 30], ["Quase acabando", 15], ["Acabando", 10], ["Acabou", 0]];

module.exports = { RAW_ITEMS, CHOPP, LEVELS };