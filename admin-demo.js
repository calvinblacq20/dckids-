/* ============================================================
   ADMIN SHOWCASE MODE
   ============================================================
   Sample data for the admin, so the UI can be walked through on a host
   that serves the files and nothing else. It exists for the Vercel build:
   Vercel has no Node process and no SQLite file, so every /api call there
   404s and the admin would otherwise be a login screen that can never be
   satisfied. The storefront needs no equivalent — app.js already falls
   back to products.json on its own.

   It turns on in exactly two places and nowhere else:
     - a *.vercel.app host, which is the showcase build, and
     - an explicit ?demo=1, for checking it locally.
   A normal localhost load and the real deployment are both untouched: the
   host does not match, the flag is absent, and every line below is a no-op.

   There is no authentication bypass here. The token it sets is not a valid
   JWT, so a real backend rejects it outright — the same "fallback-token"
   convention admin.js already uses in ~10 places for offline mode. It only
   gets anyone anywhere when there is no backend to get past.
   ============================================================ */
(function () {
    'use strict';
    var params = new URLSearchParams(location.search);
    var isShowcaseHost = /\.vercel\.app$/i.test(location.hostname);
    if (params.get('demo') !== '1' && !isShowcaseHost) {
        // The token this file sets survives in localStorage. Opening the admin
        // again without the flag left admin.js treating it as a session and
        // showing an empty dashboard — every list at zero — instead of the
        // sign-in screen. Clear it on the way out so the next load is honest.
        try {
            if ((localStorage.getItem('adminToken') || '').indexOf('fallback-token-demo') === 0) {
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminRole');
            }
        } catch (e) { /* storage unavailable — nothing to clean up */ }
        return;
    }

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
        { db_id: 1, id: 'ORD-10001', customer: 'Akua Mensah', phone: '0241234567', total: 170, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(6), delivery_area: 'Kasoa', notes: 'Gift wrapped', items: [{ productId: 1, name: 'Baby Romper Set', qty: 2, price: 85, size: '0-6M' }], source: 'instagram' },
        { db_id: 2, id: 'ORD-10002', customer: 'Kwame Asante', phone: '0249876543', total: 215, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(4), delivery_area: 'Accra', notes: '', items: [{ productId: 2, name: 'Kids Sneakers', qty: 1, price: 120, size: '25-30' }, { productId: 3, name: 'Floral Dress', qty: 1, price: 95, size: '2Y-6Y' }], source: 'whatsapp' },
        { db_id: 3, id: 'ORD-10003', customer: 'Ama Owusu', phone: '0201112222', total: 150, status: 'pending', type: 'retail', order_type: 'retail', date: daysAgo(2), delivery_area: 'Tema', notes: 'Express delivery', items: [{ productId: 4, name: 'School Bag', qty: 1, price: 150, size: 'Standard' }], source: 'instagram' },
        { db_id: 4, id: 'ORD-10004', customer: 'Yaw Boateng', phone: '0277654321', total: 255, status: 'delivered', type: 'wholesale', order_type: 'wholesale', date: daysAgo(8), delivery_area: 'Kumasi', notes: '', items: [{ productId: 1, name: 'Baby Romper Set', qty: 3, price: 85, size: '0-6M' }], source: 'referral' },
        { db_id: 5, id: 'ORD-10005', customer: 'Efua Darko', phone: '0551239876', total: 130, status: 'cancelled', type: 'retail', order_type: 'retail', date: daysAgo(1), delivery_area: 'Accra', notes: 'Customer changed mind', items: [{ productId: 5, name: 'Toddler Sandals', qty: 2, price: 65, size: '20-25' }], source: 'walk-in' },
        { db_id: 6, id: 'ORD-10006', customer: 'Kofi Amoah', phone: '0209998888', total: 120, status: 'processing', type: 'retail', order_type: 'retail', date: daysAgo(0), delivery_area: 'Kasoa', notes: '', items: [{ productId: 2, name: 'Kids Sneakers', qty: 1, price: 120, size: '25-30' }], source: 'instagram' },
        { db_id: 7, id: 'ORD-10007', customer: 'Adwoa Poku', phone: '0244445555', total: 340, status: 'delivered', type: 'retail', order_type: 'retail', date: daysAgo(3), delivery_area: 'East Legon', notes: 'Birthday order', items: [{ productId: 3, name: 'Floral Dress', qty: 2, price: 95, size: '2Y-6Y' }, { productId: 4, name: 'School Bag', qty: 1, price: 150, size: 'Standard' }], source: 'whatsapp' },
        { db_id: 8, id: 'ORD-10008', customer: 'Nana Agyeman', phone: '0233332222', total: 150, status: 'pending_deposit', type: 'preorder', order_type: 'preorder', date: daysAgo(0.5), delivery_area: 'Spintex', notes: 'Deposit paid', items: [{ productId: 6, name: 'Pre-Order Winter Coat', qty: 1, price: 150, size: '2Y-10Y' }], source: 'storefront' },
    ];

    document.addEventListener('DOMContentLoaded', function () {
        // admin.js (loaded after this file) declares its OWN fetchProducts()
        // and fetchOrdersFromServer() with `function` statements, which bind
        // to the global scope the moment that script runs — clobbering any
        // earlier assignment of the same name, regardless of script order.
        // Re-assigning here, inside DOMContentLoaded, guarantees this runs
        // after admin.js has finished declaring them, so this override is
        // the one left standing when showDashboard()/loadDashboard() call it.
        // admin.js signs the admin out when a protected endpoint answers
        // 401/403, naming "an offline fallback token now hitting a live
        // server" as the case it guards. That is precisely this page, so the
        // guard would tear the preview down the moment any call fired. There
        // is no real session here to protect and no real data to go stale, so
        // the preview opts out — scoped to this file, which is itself inert
        // on a normal host.
        window.handleSessionExpiry = function () {};

        window.fetchProducts = function () { return Promise.resolve(demoProducts.slice()); };
        // The dashboard's KPI cards and revenue chart come from
        // /analytics/sales, which a demo token cannot reach — without this the
        // preview renders a dashboard of zeros beside a populated catalogue.
        // Derive the same shape from the sample orders instead.
        var REVENUE_STATUSES = ['paid', 'shipped', 'dispatched', 'delivered', 'completed'];
        window.loadDashboardAnalytics = function () {
            var earning = demoOrders.filter(function (o) { return REVENUE_STATUSES.indexOf(o.status) !== -1; });
            var totalRevenue = earning.reduce(function (sum, o) { return sum + Number(o.total || 0); }, 0);
            var counted = demoOrders.filter(function (o) { return o.status !== 'cancelled'; }).length;

            var trend = [];
            for (var back = 6; back >= 0; back--) {
                var day = new Date(Date.now() - back * 86400000);
                var stamp = day.toISOString().slice(0, 10);
                trend.push({
                    label: day.toLocaleDateString([], { weekday: 'short' }),
                    revenue: earning.reduce(function (sum, o) {
                        return o.date.slice(0, 10) === stamp ? sum + Number(o.total || 0) : sum;
                    }, 0)
                });
            }

            return Promise.resolve({
                trend: trend,
                kpis: {
                    totalRevenue: totalRevenue,
                    totalOrders: counted,
                    avgOrderValue: earning.length ? totalRevenue / earning.length : 0,
                    growth: { totalRevenue: 12.5, totalOrders: 8.3, avgOrderValue: 3.9 }
                }
            });
        };

        // loadReviews() returns early for a fallback token and never reaches
        // the network, so the shim below never sees it. Seed it the same way
        // the orders list is seeded. admin.js resets window.adminReviews to []
        // when it parses, which is after this file, so this has to run here
        // rather than at the top.
        window.loadReviews = function () {
            window.adminReviews = demoReviews.slice();
            if (typeof renderReviewStats === 'function') renderReviewStats();
            if (typeof renderReviewsTable === 'function') renderReviewsTable();
        };

        window.fetchOrdersFromServer = function (cb) {
            window.adminOrders = demoOrders.slice();
            if (cb) cb();
        };

        // ---- The records behind the other tabs ----
        // Customers, Suppliers, Reviews and Staff each read their own
        // endpoint, so without these four the showcase opened on four empty
        // screens. The field names are the ones the server's own queries
        // return, so the renderers receive exactly the shape they expect.
        var demoCustomers = [
            { id: 1, name: 'Akua Mensah',  email: 'akua.mensah@example.com',  phone: '0241234567', address: '14 Nii Boi Street', city: 'Kasoa',      country: 'Ghana', customer_group: 'Retail',    notes: '', status: 'active', customer_account_id: 1, registered_account: 1, created_at: daysAgo(96), updated_at: daysAgo(6),  order_count: 4, total_spent: 742,  last_order_at: daysAgo(6), source: 'instagram', amount_owed: 0 },
            { id: 2, name: 'Kwame Asante', email: 'kwame.asante@example.com', phone: '0249876543', address: '2 Spintex Road',     city: 'Accra',      country: 'Ghana', customer_group: 'Retail',    notes: '', status: 'active', customer_account_id: 2, registered_account: 1, created_at: daysAgo(71), updated_at: daysAgo(4),  order_count: 3, total_spent: 615,  last_order_at: daysAgo(4), source: 'whatsapp', amount_owed: 0 },
            { id: 3, name: 'Ama Owusu',    email: '',                         phone: '0201112222', address: '7 Harbour Road',     city: 'Tema',       country: 'Ghana', customer_group: 'Retail',    notes: 'Prefers express delivery.', status: 'active', customer_account_id: null, registered_account: 0, created_at: daysAgo(44), updated_at: daysAgo(2), order_count: 2, total_spent: 300, last_order_at: daysAgo(2), source: 'referral', amount_owed: 300 },
            { id: 4, name: 'Yaw Boateng',  email: 'yaw.boateng@example.com',  phone: '0277654321', address: '19 Adum High Street', city: 'Kumasi',    country: 'Ghana', customer_group: 'Wholesale', notes: 'Buys in packs of ten.',     status: 'active', customer_account_id: null, registered_account: 0, created_at: daysAgo(120), updated_at: daysAgo(8), order_count: 6, total_spent: 2480, last_order_at: daysAgo(8), source: 'walk-in', amount_owed: 0 },
            { id: 5, name: 'Adwoa Poku',   email: 'adwoa.poku@example.com',   phone: '0244445555', address: '5 Lagos Avenue',     city: 'East Legon', country: 'Ghana', customer_group: 'Retail',    notes: '', status: 'active', customer_account_id: 3, registered_account: 1, created_at: daysAgo(30), updated_at: daysAgo(3), order_count: 2, total_spent: 465, last_order_at: daysAgo(3), source: 'instagram', amount_owed: 165 },
            { id: 6, name: 'Efua Darko',   email: '',                         phone: '0551239876', address: '',                   city: 'Accra',      country: 'Ghana', customer_group: 'Retail',    notes: '', status: 'inactive', customer_account_id: null, registered_account: 0, created_at: daysAgo(18), updated_at: daysAgo(1), order_count: 1, total_spent: 0, last_order_at: daysAgo(1), source: 'storefront', amount_owed: 120 },
        ];

        var demoSuppliers = [
            { id: 1, supplier_name: 'Guangzhou Little Threads', contact_person: 'Li Wei',       email: 'li.wei@example.com',    phone: '+86 20 5555 0101', business_address: 'Baiyun District, Guangzhou', products_supplied: 'Clothing, sets',       status: 'active',   notes: 'Main pre-order partner.', supplier_logo: null, created_at: daysAgo(210) },
            { id: 2, supplier_name: 'Accra Kids Textiles',      contact_person: 'Gifty Annan',  email: 'gifty@example.com',     phone: '0302556677',       business_address: 'Spintex Road, Accra',        products_supplied: 'Bedding, bathcare',    status: 'active',   notes: '',                        supplier_logo: null, created_at: daysAgo(150) },
            { id: 3, supplier_name: 'Tema Footwear Works',      contact_person: 'Kojo Mensah',  email: '',                      phone: '',                 business_address: 'Community 1, Tema',          products_supplied: 'Shoes, sandals',       status: 'active',   notes: 'Contact details still to confirm.', supplier_logo: null, created_at: daysAgo(64) },
            { id: 4, supplier_name: 'Kumasi Accessories Hub',   contact_person: 'Abena Sarpong', email: 'abena@example.com',    phone: '0244778899',       business_address: 'Adum, Kumasi',               products_supplied: 'Bags, hair accessories', status: 'inactive', notes: 'Paused for the season.',  supplier_logo: null, created_at: daysAgo(35) }
        ];

        var demoReviews = [
            { id: 1, product_id: 1, customer_id: 1, author_name: 'Akua Mensah',  rating: 5, title: 'Beautifully soft',        body: 'The cotton is lovely and it washed well. Buying another set.',        verified_purchase: 1, status: 'approved', created_at: daysAgo(5),  product_name: 'Baby Romper Set' },
            { id: 2, product_id: 2, customer_id: 2, author_name: 'Kwame Asante', rating: 4, title: 'Good for everyday',       body: 'Sturdy enough for school runs. Slightly narrow fit.',                 verified_purchase: 1, status: 'approved', created_at: daysAgo(9),  product_name: 'Kids Sneakers' },
            { id: 3, product_id: 3, customer_id: 3, author_name: 'Ama Owusu',    rating: 5, title: 'Exactly as pictured',     body: 'Colours are true to the photos and it arrived quickly.',              verified_purchase: 1, status: 'approved', created_at: daysAgo(12), product_name: 'Floral Dress' },
            { id: 4, product_id: 4, customer_id: null, author_name: 'Nana Agyeman', rating: 2, title: 'Strap came loose',     body: 'One strap started fraying after a fortnight. Hoping for a swap.',     verified_purchase: 0, status: 'pending',  created_at: daysAgo(2),  product_name: 'School Bag' },
            { id: 5, product_id: 7, customer_id: 5, author_name: 'Adwoa Poku',   rating: 4, title: 'Great value',             body: 'Three pairs for the price is hard to beat.',                          verified_purchase: 1, status: 'approved', created_at: daysAgo(16), product_name: 'Patterned Socks (3-pack)' }
        ];

        var demoStaff = [
            { id: 1, username: 'owner@dckidsbrand.com', role: 'manager', email: 'owner@dckidsbrand.com', full_name: 'Store Owner',  phone: '0241000001', status: 'active' },
            { id: 2, username: 'ama@dckidsbrand.com',   role: 'manager', email: 'ama@dckidsbrand.com',   full_name: 'Ama Boateng',   phone: '0241000002', status: 'active' },
            { id: 3, username: 'kofi@dckidsbrand.com',  role: 'staff',   email: 'kofi@dckidsbrand.com',  full_name: 'Kofi Appiah',   phone: '0241000003', status: 'active' },
            { id: 4, username: 'yaa@dckidsbrand.com',   role: 'staff',   email: 'yaa@dckidsbrand.com',   full_name: 'Yaa Serwaa',    phone: '0241000004', status: 'pending' }
        ];

        // Payments arrive on their own endpoint, so the showcase needs its
        // own set — derived from the sample orders so the figures agree with
        // what the Orders tab shows.
        var demoPayments = (function () {
            var methods = ['Mobile Money', 'Mobile Money', 'Bank Transfer', 'Mobile Money', 'Cash', 'Mobile Money', 'Bank Transfer'];
            var settled = demoOrders.filter(function (o) {
                return ['paid', 'shipped', 'dispatched', 'delivered', 'completed'].indexOf(o.status) !== -1;
            });
            return settled.map(function (o, i) {
                return {
                    id: i + 1,
                    amount: o.total,
                    method: methods[i % methods.length],
                    provider: 'Paystack',
                    reference: 'DCK-' + String(2026) + '-' + String(1001 + i),
                    currency: 'GHS',
                    paid_at: o.date,
                    order_number: o.id,
                    customer_name: o.customer,
                    kind: 'Full'
                };
            });
        })();

        var demoPaymentsPayload = function () {
            var received = demoPayments.reduce(function (sum, p) { return sum + p.amount; }, 0);
            var byMethod = {};
            demoPayments.forEach(function (p) {
                if (!byMethod[p.method]) byMethod[p.method] = { method: p.method, count: 0, amount: 0 };
                byMethod[p.method].count++;
                byMethod[p.method].amount += p.amount;
            });
            var owed = demoOrders
                .filter(function (o) { return ['pending', 'pending_deposit', 'awaiting_payment', 'payment_review'].indexOf(o.status) !== -1; })
                .reduce(function (sum, o) { return sum + o.total; }, 0);
            return {
                period_days: 30,
                payments: demoPayments.slice(),
                summary: {
                    received: received,
                    count: demoPayments.length,
                    average: demoPayments.length ? received / demoPayments.length : 0,
                    previous: Math.round(received * 1.38),
                    still_owed: owed
                },
                by_method: Object.keys(byMethod).map(function (k) { return byMethod[k]; })
                    .sort(function (a, b) { return b.amount - a.amount; })
            };
        };

        // ---- Writes ----
        // Opening the create-order form worked, but submitting it did not:
        // admin.js POSTs to /api/orders, which 404s on a host that only
        // serves files, so the form ended on an error toast. The same is
        // true of every other write the admin offers.
        //
        // So the showcase answers the app's own calls instead of letting
        // them fall off the end. This is a last resort by design — it only
        // ever replaces fetch after the showcase gate above has passed, it
        // only touches same-origin /api/ paths, and anything else is handed
        // to the real fetch untouched.
        var realFetch = window.fetch.bind(window);
        var nextOrderNumber = 10009;

        var jsonResponse = function (body, status) {
            return new Response(JSON.stringify(body), {
                status: status || 200,
                headers: { 'Content-Type': 'application/json' }
            });
        };

        var findProduct = function (id) {
            for (var i = 0; i < demoProducts.length; i++) {
                if (String(demoProducts[i].id) === String(id)) return demoProducts[i];
            }
            return null;
        };

        var createOrder = function (payload) {
            var items = (payload.items || []).map(function (line) {
                var p = findProduct(line.id);
                return {
                    productId: line.id,
                    name: p ? p.name : 'Item',
                    qty: Number(line.quantity) || 1,
                    price: p ? Number(p.price) : 0,
                    size: line.size || ''
                };
            });
            var total = items.reduce(function (sum, i) { return sum + i.price * i.qty; }, 0);
            var discount = Number(payload.discount_percent) || 0;
            if (discount > 0) total = total * (1 - Math.min(100, discount) / 100);
            total = Math.round(total * 100) / 100;

            var order = {
                db_id: nextOrderNumber,
                id: 'ORD-' + nextOrderNumber,
                customer: payload.customer_name || 'Walk-in customer',
                phone: payload.customer_phone || '',
                total: total,
                status: 'pending',
                type: payload.order_type || 'retail',
                order_type: payload.order_type || 'retail',
                date: new Date().toISOString(),
                delivery_area: (payload.delivery_address && payload.delivery_address.area) || '',
                notes: payload.notes || '',
                items: items
            };
            nextOrderNumber++;
            demoOrders.unshift(order);
            return { success: true, order_number: order.id, total_amount: total };
        };

        window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            var path = url.indexOf(location.origin) === 0 ? url.slice(location.origin.length) : url;
            if (path.indexOf('/api/') !== 0) return realFetch(input, init);

            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            var body = {};
            if (init && typeof init.body === 'string') {
                try { body = JSON.parse(init.body); } catch (e) { body = {}; }
            }

            if (method === 'POST' && path.indexOf('/api/orders') === 0) {
                return Promise.resolve(jsonResponse(createOrder(body)));
            }

            // Status changes: reflect them so the board moves as it would.
            var statusMatch = path.match(/^\/api\/orders\/([^/?]+)\/status/);
            if (statusMatch && method !== 'GET') {
                var wanted = String(statusMatch[1]);
                for (var i = 0; i < demoOrders.length; i++) {
                    if (String(demoOrders[i].db_id) === wanted || demoOrders[i].id === wanted) {
                        if (body.status) demoOrders[i].status = body.status;
                        break;
                    }
                }
                return Promise.resolve(jsonResponse({ success: true }));
            }

            // Creates, edits and deletes for the other tabs. Acknowledging a
            // write without recording it is worse than refusing it: the form
            // reported "added successfully", closed, and the list was
            // unchanged, so every Add button looked broken. These mutate the
            // arrays the GETs above read, so the reload each form triggers
            // shows the record.
            var nextId = function (list) {
                return list.reduce(function (max, r) { return Math.max(max, Number(r.id) || 0); }, 0) + 1;
            };
            var idFromPath = function (prefix) {
                var m = path.match(new RegExp('^' + prefix + '/([^/?]+)'));
                return m ? m[1] : null;
            };
            var removeFrom = function (list, id) {
                for (var i = 0; i < list.length; i++) {
                    if (String(list[i].id) === String(id)) { list.splice(i, 1); return true; }
                }
                return false;
            };
            var mergeInto = function (list, id, patch) {
                for (var i = 0; i < list.length; i++) {
                    if (String(list[i].id) === String(id)) {
                        Object.keys(patch).forEach(function (k) { list[i][k] = patch[k]; });
                        return list[i];
                    }
                }
                return null;
            };

            var collections = [
                { prefix: '/api/admin/customers', list: demoCustomers, build: function (b) {
                    return {
                        id: nextId(demoCustomers), name: b.name || 'New customer', email: b.email || '',
                        phone: b.phone || '', address: b.address || '', city: b.city || '',
                        country: b.country || 'Ghana', customer_group: b.customer_group || 'Retail',
                        notes: b.notes || '', status: b.status || 'active', customer_account_id: null,
                        registered_account: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                        order_count: 0, total_spent: 0, last_order_at: null
                    };
                } },
                { prefix: '/api/suppliers', list: demoSuppliers, build: function (b) {
                    return {
                        id: nextId(demoSuppliers), supplier_name: b.supplier_name || b.company || 'New supplier',
                        contact_person: b.contact_person || '', email: b.email || '', phone: b.phone || '',
                        business_address: b.business_address || b.address || '',
                        products_supplied: b.products_supplied || '', status: b.status || 'active',
                        notes: b.notes || '', supplier_logo: null, created_at: new Date().toISOString()
                    };
                } },
                { prefix: '/api/users', list: demoStaff, build: function (b) {
                    return {
                        id: nextId(demoStaff), username: b.email || b.username || 'new@dckidsbrand.com',
                        role: b.role || 'staff', email: b.email || b.username || '',
                        full_name: b.full_name || b.name || 'New account', phone: b.phone || '',
                        status: b.status || 'active'
                    };
                } },
                { prefix: '/api/products', list: demoProducts, build: function (b) {
                    return {
                        id: nextId(demoProducts), name: b.name || 'New product', sku: b.sku || '',
                        size: b.size || '', price: Number(b.price) || 0, img: b.img || 'images/placeholder.svg',
                        cat: b.cat || b.category || 'clothing', stock: Number(b.stock) || 0,
                        badge: b.badge || '', fulfillment_type: b.fulfillment_type || 'in_stock',
                        description: b.description || ''
                    };
                } }
            ];

            for (var ci = 0; ci < collections.length; ci++) {
                var c = collections[ci];
                if (path.indexOf(c.prefix) !== 0) continue;
                var recordId = idFromPath(c.prefix);
                if (method === 'POST' && !recordId) {
                    var made = c.build(body);
                    c.list.unshift(made);
                    return Promise.resolve(jsonResponse(made, 201));
                }
                if ((method === 'PUT' || method === 'PATCH') && recordId) {
                    var updated = mergeInto(c.list, recordId, body);
                    return Promise.resolve(jsonResponse(updated || { success: true }));
                }
                if (method === 'DELETE' && recordId) {
                    removeFrom(c.list, recordId);
                    return Promise.resolve(jsonResponse({ success: true }));
                }
            }

            if (method !== 'GET') return Promise.resolve(jsonResponse({ success: true }));

            // Reads the overrides above do not already cover. An empty list
            // is a truthful answer here — the showcase holds no such records
            // — and it keeps the panels on their empty states instead of
            // their error states.
            if (path.indexOf('/api/orders') === 0)           return Promise.resolve(jsonResponse(demoOrders.slice()));
            if (path.indexOf('/api/products') === 0)         return Promise.resolve(jsonResponse(demoProducts.slice()));
            if (path.indexOf('/api/admin/payments') === 0)   return Promise.resolve(jsonResponse(demoPaymentsPayload()));
            if (path.indexOf('/api/admin/customers') === 0)  return Promise.resolve(jsonResponse(demoCustomers.slice()));
            if (path.indexOf('/api/suppliers') === 0)        return Promise.resolve(jsonResponse(demoSuppliers.slice()));
            if (path.indexOf('/api/admin/reviews') === 0)    return Promise.resolve(jsonResponse(demoReviews.slice()));
            if (path.indexOf('/api/users') === 0)            return Promise.resolve(jsonResponse(demoStaff.slice()));
            if (path.indexOf('/api/settings') === 0)         return Promise.resolve(jsonResponse({}));
            return Promise.resolve(jsonResponse([]));
        };

        var banner = document.createElement('div');
        banner.textContent = 'Showcase — sample data, not connected to a live store';
        banner.className = 'demo-banner';
        document.body.appendChild(banner);
        document.body.classList.add('is-demo');

        // admin.js's own bootstrap (also a DOMContentLoaded listener, registered
        // after this one and so firing after this) sees the fallback-token and
        // calls showDashboard() itself — see the matching edit in admin.js's
        // bootstrap check. Nothing further to do here.
    });
})();
