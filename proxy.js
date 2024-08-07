const axios = require('axios');
const express = require('express');
const cheerio = require('cheerio');
const app = express();

app.use(express.json());

function rewriteUrls(content, baseUrl, contentType) {
    if (contentType && contentType.includes('text/html')) {
        const $ = cheerio.load(content);
        $('script[src], link[href], img[src], a[href], form[action]').each((_, element) => {
            const srcAttr = $(element).attr('src');
            const hrefAttr = $(element).attr('href');
            const actionAttr = $(element).attr('action');

            const fixUrl = (url) => {
                if (url && !/^https?:\/\//i.test(url)) {
                    return new URL(url, baseUrl).href.replace(/^https?:\/\//, '/');
                }
                return url.replace(/^https?:\/\//, '/');
            };

            if (srcAttr) {
                $(element).attr('src', fixUrl(srcAttr));
            }
            if (hrefAttr) {
                $(element).attr('href', fixUrl(hrefAttr));
            }
            if (actionAttr) {
                $(element).attr('action', fixUrl(actionAttr));
            }
        });

        // Handle favicon
        if (!$('link[rel="icon"]').length) {
            $('head').append(`<link rel="icon" href="${baseUrl}/favicon.ico">`);
        }

        return $.html();
    } else if (contentType && contentType.includes('application/javascript')) {
        let updatedContent = content.toString('utf8');
        const baseUrl = new URL(baseUrl).origin.replace(/^https?:\/\//, '/');
        updatedContent = updatedContent.replace(/(src|href|url)\s*=\s*['"]([^'"]+)['"]/g, (match, p1, p2) => {
            if (!/^https?:\/\//i.test(p2)) {
                const fixedUrl = new URL(p2, baseUrl).href.replace(/^https?:\/\//, '/');
                return `${p1}="${fixedUrl}"`;
            }
            return match;
        });
        return updatedContent;
    }
    return content;
}

async function proxyHandler(req, res) {
    let targetUrl = req.url.slice(1);
    if (!targetUrl) {
        res.status(400).send({ error: 'Cannot get without URL' });
        return;
    }

    try {
        // Decode the URL and add https if it doesn't start with http or https
        targetUrl = decodeURIComponent(targetUrl);
        if (!/^https?:\/\//i.test(targetUrl)) {
            targetUrl = `https://${targetUrl}`;
        }

        console.log(`Proxying request to: ${targetUrl}`);

        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: {
                ...req.headers,
                host: new URL(targetUrl).host,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (compatible; ProxyServer/1.0)'
            },
            data: req.method === 'POST' ? req.body : undefined,
            responseType: 'arraybuffer',
            validateStatus: null,
            maxRedirects: 0,
        });

        console.log(`Received response with status: ${response.status}`);

        // Handle CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (response.status === 302 || response.status === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
                const absoluteRedirectUrl = new URL(redirectUrl, targetUrl).toString();
                const proxyRedirectUrl = absoluteRedirectUrl.replace(/^https?:\/\//, '/');
                console.log(`Redirecting to: ${proxyRedirectUrl}`);
                res.redirect(proxyRedirectUrl);
                return;
            }
        }

        const contentType = response.headers['content-type'];
        const encoding = response.headers['content-encoding'];

        if (contentType && (contentType.includes('text/html') || contentType.includes('application/javascript'))) {
            let content = response.data;

            if (encoding) {
                res.set('Content-Encoding', encoding);
            }

            const baseUrl = `https://${new URL(targetUrl).host}`;
            const modifiedContent = rewriteUrls(content, baseUrl, contentType);
            res.set('Content-Type', contentType);
            res.status(response.status).send(modifiedContent);
        } else {
            res.set('Content-Type', contentType);
            res.status(response.status).send(response.data);
        }
    } catch (error) {
        console.error('Proxy error:', error.message);
        if (error.response) {
            console.error('Response error status:', error.response.status);
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            console.error('No response received');
            res.status(502).send({ error: 'Bad Gateway' });
        } else {
            console.error('Request setup error');
            res.status(400).send({ error: 'Cannot get without URL' });
        }
    }
}

app.all('/*', proxyHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
