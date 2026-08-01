/* ============================================================
   ADMIN DEMO PREVIEW MODE
   ============================================================
   Entirely inert unless the page is opened with ?demo=1 in the URL — every
   line below is a no-op on a normal admin.html load. Never touches the real
   backend or database: it reuses the SAME "fallback-token" offline-mode
   convention already built into admin.js (used in ~10 places for orders,
   suppliers, settings, notifications when there's no live session), so it
   rides on already-tested code paths instead of inventing new ones.

   Why this exists: this build is sometimes deployed to a static host (e.g.
   a Vercel preview) with no backend attached at all, purely so someone can
   click through the admin UI in a presentation. There is no real login,
   no real data, and no real mutation possible — any write action still
   carries the fake token, which a real server would reject outright.
   ============================================================ */
(function () {
    'use strict';
    var params = new URLSearchParams(location.search);
    if (params.get('demo') !== '1') return;

    var DEMO_TOKEN = 'fallback-token-demo-preview';
    localStorage.setItem('adminToken', DEMO_TOKEN);
    localStorage.setItem('adminRole', 'manager');

    // ---- Sample catalogue (admin.js has no built-in product seed — only
    // orders/suppliers/settings/notifications are seeded via initSeedData) ----
    var demoProducts = [
        { id: 1, name: 'Baby Romper Set', sku: 'CLO-0001', size: '0-6M', price: 85, img: 'images/product_59.jpg', cat: 'clothing', stock: 14, badge: 'new', fulfillment_type: 'in_stock', description: 'Soft cotton romper set for newborns.' },
        { id: 2, name: 'Kids Sneakers', sku: 'SHO-0001', size: '25-30', price: 120, img: 'images/product_66.jpg', cat: 'shoes', stock: 3, badge: 'hot', fulfillment_type: 'in_stock', description: 'Everyday sneakers built for play.' },
        { id: 3, name: 'Floral Dress', sku: 'CLO-0002', size: '2Y-6Y', price: 95, img: 'images/product_57.jpg', cat: 'clothing', stock: 9, badge: '', fulfillment_type: 'in_stock', description: 'Lightweight floral dress for warm days.' },
        { id: 4, name: 'School Bag', sku: 'ACC-0001', size: 'Standard', price: 150, img: 'images/product_29.jpg', cat: 'accessories', stock: 6, badge: '', fulfillment_type: 'in_stock', description: 'Durable school bag with padded straps.' },
        { id: 5, name: 'Toddler Sandals', sku: 'SHO-0002', size: '20-25', price: 65, img: 'images/product_67.jpg', cat: 'shoes', stock: 0, badge: '', fulfillment_type: 'in_stock', description: 'Breathable sandals for toddlers.' },
        { id: 6, name: 'Pre-Order Winter Coat', sku: 'CLO-0003', size: '2Y-10Y', price: 150, img: 'images/product_78.jpg', cat: 'clothing', stock: 10, badge: 'china', fulfillment_type: 'preorder', description: 'Warm winter coat, arriving next shipment.' },
        { id: 7, name: 'Patterned Socks (3-pack)', sku: 'ACC-0002', size: 'One Size', price: 20, img: 'images/product_2.jpg', cat: 'accessories', stock: 32, badge: '', fulfillment_type: 'in_stock', description: 'Everyday socks, three per pack.' },
        { id: 8, name: 'Graphic T-Shirt', sku: 'CLO-0004', size: '2Y-8Y', price: 124, img: 'images/product_1.jpg', cat: 'clothing', stock: 5, badge: '', fulfillment_type: 'in_stock', description: 'Printed cotton tee for everyday wear.' }
    ];

    // ---- Sample orders, in the exact shape fetchOrdersFromServer() normally
    // produces from the API, so every existing render/format function (which
    // already expects db_id/id/customer/phone/total/status/type/date/items)
    // works unmodified. ----
    function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
    var demoOrders = [
        { db_id: 1, id: 'ORD-10001', customer: 'Akua Mensah', phone: '0241234567', total: 170, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(6), delivery_area: 'Kasoa', notes: 'Gift wrapped', items: [{ productId: 1, name: 'Baby Romper Set', qty: 2, price: 85, size: '0-6M' }] },
        { db_id: 2, id: 'ORD-10002', customer: 'Kwame Asante', phone: '0249876543', total: 215, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(4), delivery_area: 'Accra', notes: '', items: [{ productId: 2, name: 'Kids Sneakers', qty: 1, price: 120, size: '25-30' }, { productId: 3, name: 'Floral Dress', qty: 1, price: 95, size: '2Y-6Y' }] },
        { db_id: 3, id: 'ORD-10003', customer: 'Ama Owusu', phone: '0201112222', total: 150, status: 'pending', type: 'retail', order_type: 'retail', date: daysAgo(2), delivery_area: 'Tema', notes: 'Express delivery', items: [{ productId: 4, name: 'School Bag', qty: 1, price: 150, size: 'Standard' }] },
        { db_id: 4, id: 'ORD-10004', customer: 'Yaw Boateng', phone: '0277654321', total: 255, status: 'delivered', type: 'wholesale', order_type: 'wholesale', date: daysAgo(8), delivery_area: 'Kumasi', notes: '', items: [{ productId: 1, name: 'Baby Romper Set', qty: 3, price: 85, size: '0-6M' }] },
        { db_id: 5, id: 'ORD-10005', customer: 'Efua Darko', phone: '0551239876', total: 130, status: 'cancelled', type: 'retail', order_type: 'retail', date: daysAgo(1), delivery_area: 'Accra', notes: 'Customer changed mind', items: [{ productId: 5, name: 'Toddler Sandals', qty: 2, price: 65, size: '20-25' }] },
        { db_id: 6, id: 'ORD-10006', customer: 'Kofi Amoah', phone: '0209998888', total: 120, status: 'processing', type: 'retail', order_type: 'retail', date: daysAgo(0), delivery_area: 'Kasoa', notes: '', items: [{ productId: 2, name: 'Kids Sneakers', qty: 1, price: 120, size: '25-30' }] },
        { db_id: 7, id: 'ORD-10007', customer: 'Adwoa Poku', phone: '0244445555', total: 340, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(3), delivery_area: 'East Legon', notes: 'Birthday order', items: [{ productId: 3, name: 'Floral Dress', qty: 2, price: 95, size: '2Y-6Y' }, { productId: 4, name: 'School Bag', qty: 1, price: 150, size: 'Standard' }] },
        { db_id: 8, id: 'ORD-10008', customer: 'Nana Agyeman', phone: '0233332222', total: 150, status: 'pending_deposit', type: 'preorder', order_type: 'preorder', date: daysAgo(0.5), delivery_area: 'Spintex', notes: 'Deposit paid', items: [{ productId: 6, name: 'Pre-Order Winter Coat', qty: 1, price: 150, size: '2Y-10Y' }] }
    ];

    document.addEventListener('DOMContentLoaded', function () {
        // admin.js (loaded after this file) declares its OWN fetchProducts()
        // and fetchOrdersFromServer() with `function` statements, which bind
        // to the global scope the moment that script runs — clobbering any
        // earlier assignment of the same name, regardless of script order.
        // Re-assigning here, inside DOMContentLoaded, guarantees this runs
        // after admin.js has finished declaring them, so this override is
        // the one left standing when showDashboard()/loadDashboard() call it.
        window.fetchProducts = function () { return Promise.resolve(demoProducts.slice()); };
        window.fetchOrdersFromServer = function (cb) {
            window.adminOrders = demoOrders.slice();
            if (cb) cb();
        };

        var banner = document.createElement('div');
        banner.textContent = 'Demo preview — sample data only, not connected to the live store';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#111827;' +
            'color:#fff;text-align:center;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;' +
            'padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.15);';
        document.body.appendChild(banner);
        document.body.style.paddingTop = '36px';

        // admin.js's own bootstrap (also a DOMContentLoaded listener, registered
        // after this one and so firing after this) sees the fallback-token and
        // calls showDashboard() itself — see the matching edit in admin.js's
        // bootstrap check. Nothing further to do here.
    });
})();
