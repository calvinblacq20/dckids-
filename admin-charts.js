/* Plain SVG charts for the admin.
 *
 * The reference admin draws its charts as SVG rather than pulling in a chart
 * library: lines in ink, pastels only as labelled fills, a "nice" axis step,
 * and a hover read-out. This is that, in the vanilla JS the rest of this
 * project is written in.
 *
 * Every entry point takes the id of the element the chart belongs in. The
 * markup still carries <canvas> elements from the old library, so each one is
 * swapped for a <div> of the same id on first use; nothing in admin.html had
 * to change.
 *
 * Public API:
 *   admLine(id, opts)      one or more series over shared labels
 *   admSpark(id, values)   a small area line, no axes
 *   admBars(id, opts)      a labelled bar column per category
 *   admSegments(id, opts)  one stacked bar plus a legend, for composition
 */
(function (global) {
    'use strict';

    var NS = 'http://www.w3.org/2000/svg';
    var INK = '#242426';
    var INK_50 = 'rgba(36, 36, 38, 0.5)';
    var INK_12 = 'rgba(36, 36, 38, 0.12)';
    var ACCENT = '#ffc4d7';

    /* A round number at or above raw, so the axis reads 0/2k/4k and not
       0/1,873/3,746. */
    function niceStep(raw) {
        if (!(raw > 0)) return 1;
        var exp = Math.pow(10, Math.floor(Math.log10(raw)));
        var f = raw / exp;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    }

    function el(name, attrs) {
        var node = document.createElementNS(NS, name);
        for (var key in attrs) {
            if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
        }
        return node;
    }

    /* The old markup holds <canvas>; SVG cannot live inside one. */
    function host(id) {
        var node = document.getElementById(id);
        if (!node) return null;
        if (node.tagName.toLowerCase() === 'canvas') {
            var div = document.createElement('div');
            div.id = id;
            div.className = node.className;
            if (node.getAttribute('aria-label')) div.setAttribute('aria-label', node.getAttribute('aria-label'));
            node.parentNode.replaceChild(div, node);
            node = div;
        }
        node.classList.add('adm-chart');
        node.innerHTML = '';
        return node;
    }

    /* A chart is often built while its tab is still hidden, where the host
       measures 0 and the drawing would letterbox inside a fallback viewBox.
       Draw when there is a width, and redraw when it changes. */
    function onWidth(node, draw) {
        var last = 0;
        var run = function () {
            var w = Math.round(node.clientWidth || node.getBoundingClientRect().width || 0);
            if (!w || w === last) return;
            last = w;
            draw(w);
        };
        if (node._admObserver) node._admObserver.disconnect();
        if (typeof ResizeObserver === 'function') {
            node._admObserver = new ResizeObserver(run);
            node._admObserver.observe(node);
        }
        run();
    }

    function emptyNote(node, text) {
        var p = document.createElement('p');
        p.className = 'adm-chart__empty t-cap muted';
        p.textContent = text || 'Nothing to show for this period.';
        node.appendChild(p);
    }

    function numbersIn(series) {
        var out = [];
        series.forEach(function (s) {
            (s.values || []).forEach(function (v) { if (typeof v === 'number' && isFinite(v)) out.push(v); });
        });
        return out;
    }

    function admLine(id, opts) {
        var node = host(id);
        if (!node) return;
        opts = opts || {};
        var series = opts.series || [];
        var labels = opts.labels || [];
        var height = opts.height || 240;
        var fmt = opts.format || String;
        var axisFmt = opts.axisFormat || fmt;

        var all = numbersIn(series);
        if (!all.length || all.every(function (v) { return v === 0; })) {
            emptyNote(node, opts.emptyText);
            return;
        }

        onWidth(node, function (width) { drawLine(node, opts, series, labels, height, fmt, axisFmt, all, width); });
    }

    function drawLine(node, opts, series, labels, height, fmt, axisFmt, all, width) {
        node.innerHTML = '';
        var rawMax = Math.max.apply(null, all.concat([0]));
        var step = niceStep(rawMax / 4 || 1);
        var max = Math.max(step, Math.ceil(rawMax / step) * step);
        var ticks = [];
        for (var t = 0; t <= Math.round(max / step); t++) ticks.push(t * step);

        var left = 28;
        ticks.forEach(function (v) { left = Math.max(left, String(axisFmt(v)).length * 6.6 + 10); });
        var right = 8, top = 10, bottom = 28;
        var innerW = Math.max(10, width - left - right);
        var innerH = height - top - bottom;
        var n = labels.length || all.length;
        var x = function (i) { return left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW); };
        var y = function (v) { return top + innerH - (v / max) * innerH; };

        var svg = el('svg', { width: '100%', height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img' });
        svg.setAttribute('aria-label', opts.ariaLabel || 'Chart');

        ticks.forEach(function (v) {
            svg.appendChild(el('line', { x1: left, y1: y(v), x2: left + innerW, y2: y(v), stroke: INK_12, 'stroke-width': 1 }));
            var label = el('text', { x: left - 8, y: y(v) + 4, 'text-anchor': 'end', fill: INK_50, 'font-size': 11 });
            label.textContent = axisFmt(v);
            svg.appendChild(label);
        });

        series.forEach(function (s) {
            var pts = [];
            (s.values || []).forEach(function (v, i) {
                if (typeof v === 'number' && isFinite(v)) pts.push([x(i), y(v)]);
            });
            if (pts.length < 2) return;
            if (s.area !== false) {
                var area = 'M' + pts[0][0].toFixed(1) + ',' + (top + innerH) +
                    'L' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L') +
                    'L' + pts[pts.length - 1][0].toFixed(1) + ',' + (top + innerH) + 'Z';
                svg.appendChild(el('path', { d: area, fill: s.fill || ACCENT, 'fill-opacity': s.fillOpacity || 0.38, stroke: 'none' }));
            }
            var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L');
            svg.appendChild(el('path', {
                d: line, fill: 'none', stroke: s.color || INK, 'stroke-width': s.width || 1.6,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                'stroke-dasharray': s.dashed ? '4 4' : null
            }));
        });

        // Only as many date labels as will fit without colliding.
        var maxLabels = Math.max(2, Math.floor(innerW / 76));
        var labelStep = Math.max(1, Math.ceil(n / maxLabels));
        labels.forEach(function (text, i) {
            if (i % labelStep !== 0 && i !== n - 1) return;
            var label = el('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', fill: INK_50, 'font-size': 11 });
            label.textContent = text;
            svg.appendChild(label);
        });

        node.appendChild(svg);
        attachHover(node, svg, { x: x, y: y, series: series, labels: labels, n: n, left: left, innerW: innerW, top: top, innerH: innerH, fmt: fmt });
    }

    /* A vertical rule and a dot on the nearest point, with a read-out. */
    function attachHover(node, svg, g) {
        var rule = el('line', { y1: g.top, y2: g.top + g.innerH, stroke: INK_12, 'stroke-width': 1, opacity: 0 });
        var dot = el('circle', { r: 3.5, fill: INK, opacity: 0 });
        svg.appendChild(rule);
        svg.appendChild(dot);

        var tip = document.createElement('div');
        tip.className = 'adm-chart__tip';
        tip.hidden = true;
        node.appendChild(tip);

        var main = (g.series[0] && g.series[0].values) || [];
        node.addEventListener('pointermove', function (e) {
            var rect = node.getBoundingClientRect();
            var scale = rect.width ? (svg.viewBox.baseVal.width / rect.width) : 1;
            var px = (e.clientX - rect.left) * scale - g.left;
            var i = Math.min(g.n - 1, Math.max(0, Math.round((px / g.innerW) * (g.n - 1))));
            var v = main[i];
            if (typeof v !== 'number' || !isFinite(v)) { hide(); return; }
            rule.setAttribute('x1', g.x(i)); rule.setAttribute('x2', g.x(i)); rule.setAttribute('opacity', 1);
            dot.setAttribute('cx', g.x(i)); dot.setAttribute('cy', g.y(v)); dot.setAttribute('opacity', 1);
            tip.hidden = false;
            tip.textContent = (g.labels[i] ? g.labels[i] + ' · ' : '') + g.fmt(v);
            tip.style.left = Math.min(Math.max(g.x(i) / scale, 56), rect.width - 56) + 'px';
        });
        node.addEventListener('pointerleave', hide);
        function hide() { rule.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hidden = true; }
    }

    function admSpark(id, values, color, fill) {
        var node = host(id);
        if (!node) return;
        var nums = (values || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
        if (nums.length < 2) { node.innerHTML = ''; return; }

        var width = 160, height = 32, pad = 2;
        var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
        var span = (max - min) || 1;
        var x = function (i) { return pad + (i / (nums.length - 1)) * (width - pad * 2); };
        var y = function (v) { return pad + (1 - (v - min) / span) * (height - pad * 2); };

        var svg = el('svg', { width: '100%', height: height, viewBox: '0 0 ' + width + ' ' + height,
            preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
        var pts = nums.map(function (v, i) { return [x(i), y(v)]; });
        var d = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L');
        svg.appendChild(el('path', {
            d: 'M' + pts[0][0] + ',' + height + 'L' + d + 'L' + pts[pts.length - 1][0] + ',' + height + 'Z',
            fill: fill || ACCENT, 'fill-opacity': 0.45, stroke: 'none'
        }));
        svg.appendChild(el('path', { d: 'M' + d, fill: 'none', stroke: color || INK, 'stroke-width': 1.4,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
        node.appendChild(svg);
    }

    function admBars(id, opts) {
        var node = host(id);
        if (!node) return;
        opts = opts || {};
        var labels = opts.labels || [];
        var values = (opts.values || []).map(Number);
        var height = opts.height || 240;
        var fmt = opts.format || String;

        if (!values.length || values.every(function (v) { return !v; })) {
            emptyNote(node, opts.emptyText);
            return;
        }

        onWidth(node, function (width) { drawBars(node, opts, labels, values, height, fmt, width); });
    }

    function drawBars(node, opts, labels, values, height, fmt, width) {
        node.innerHTML = '';
        var rawMax = Math.max.apply(null, values);
        var step = niceStep(rawMax / 4 || 1);
        var max = Math.max(step, Math.ceil(rawMax / step) * step);
        var left = 28, right = 8, top = 10, bottom = 34;
        for (var t = 0; t <= Math.round(max / step); t++) left = Math.max(left, String(fmt(t * step)).length * 6.6 + 10);
        var innerW = Math.max(10, width - left - right);
        var innerH = height - top - bottom;
        var slot = innerW / values.length;
        var barW = Math.min(34, slot * 0.6);

        var svg = el('svg', { width: '100%', height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img' });
        svg.setAttribute('aria-label', opts.ariaLabel || 'Chart');

        for (var i = 0; i <= Math.round(max / step); i++) {
            var gy = top + innerH - (i * step / max) * innerH;
            svg.appendChild(el('line', { x1: left, y1: gy, x2: left + innerW, y2: gy, stroke: INK_12, 'stroke-width': 1 }));
            var gl = el('text', { x: left - 8, y: gy + 4, 'text-anchor': 'end', fill: INK_50, 'font-size': 11 });
            gl.textContent = fmt(i * step);
            svg.appendChild(gl);
        }

        values.forEach(function (v, i) {
            var h = (v / max) * innerH;
            var cx = left + slot * i + slot / 2;
            svg.appendChild(el('rect', {
                x: cx - barW / 2, y: top + innerH - h, width: barW, height: Math.max(1, h),
                rx: 4, fill: opts.color || INK, 'fill-opacity': opts.opacity || 0.85
            }));
            var text = el('text', { x: cx, y: height - 10, 'text-anchor': 'middle', fill: INK_50, 'font-size': 11 });
            text.textContent = labels[i] || '';
            svg.appendChild(text);
        });

        node.appendChild(svg);
    }

    /* The reference shows composition as one stacked bar with a legend
       underneath, not a ring — it is easier to read and to label. */
    function admSegments(id, opts) {
        var node = host(id);
        if (!node) return;
        opts = opts || {};
        var items = (opts.items || []).filter(function (s) { return Number(s.value) > 0; });
        var fmt = opts.format || String;
        if (!items.length) { emptyNote(node, opts.emptyText); return; }

        var total = items.reduce(function (sum, s) { return sum + Number(s.value); }, 0);
        var palette = opts.palette || ['#ffc4d7', '#c0adff', '#b8deff', '#e0c5b6', '#a5b2cf', '#d9d5dc'];

        var bar = document.createElement('div');
        bar.className = 'adm-segbar';
        items.forEach(function (s, i) {
            var seg = document.createElement('span');
            seg.style.width = (Number(s.value) / total * 100) + '%';
            seg.style.background = s.color || palette[i % palette.length];
            seg.title = s.label + ' · ' + fmt(s.value);
            bar.appendChild(seg);
        });

        var legend = document.createElement('ul');
        legend.className = 'adm-seglegend';
        items.forEach(function (s, i) {
            var li = document.createElement('li');
            var swatch = document.createElement('i');
            swatch.style.background = s.color || palette[i % palette.length];
            li.appendChild(swatch);
            var name = document.createElement('span');
            name.className = 'grow truncate';
            name.textContent = s.label;
            li.appendChild(name);
            var value = document.createElement('b');
            value.className = 'tabular';
            value.textContent = fmt(s.value);
            li.appendChild(value);
            legend.appendChild(li);
        });

        node.appendChild(bar);
        node.appendChild(legend);
    }

    global.admLine = admLine;
    global.admSpark = admSpark;
    global.admBars = admBars;
    global.admSegments = admSegments;
    global.admNiceStep = niceStep;
})(window);
