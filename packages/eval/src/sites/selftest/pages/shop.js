// The selftest's mini shop: a search over a fixed catalogue, a product page and a cart kept in sessionStorage.
const PRODUCTS = { kettle: 'Electric Kettle', grinder: 'Hand Grinder', scale: 'Coffee Scale' };
const params = new URLSearchParams(location.search);
const cart = JSON.parse(sessionStorage.getItem('cart') || '[]');

renderCartCount();

const results = document.getElementById('results');
if (results) {
    const query = (params.get('q') || '').toLowerCase();
    for (const [id, name] of Object.entries(PRODUCTS)) {
        if (name.toLowerCase().includes(query)) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = `/product.html?id=${id}`;
            link.textContent = name;
            item.append(link);
            results.append(item);
        }
    }
}

const productName = document.getElementById('product-name');
if (productName) {
    const id = params.get('id');
    productName.textContent = PRODUCTS[id];
    document.getElementById('add-to-cart').addEventListener('click', () => {
        cart.push(id);
        sessionStorage.setItem('cart', JSON.stringify(cart));
        renderCartCount();
    });
}

const cartItems = document.getElementById('cart-items');
if (cartItems) {
    for (const id of cart) {
        const item = document.createElement('li');
        item.textContent = PRODUCTS[id];
        cartItems.append(item);
    }
}

function renderCartCount() {
    document.getElementById('cart-count').textContent = String(cart.length);
}
