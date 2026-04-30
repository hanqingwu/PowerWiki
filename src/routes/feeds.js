/**
 * Feed Routes
 *
 * RSS 和 Sitemap 路由模块
 *
 * @module routes/feeds
 */

const express = require('express');
const { parseMarkdown } = require('../utils/markdownParser');
const seoHelper = require('../utils/seoHelper');
const cacheManager = require('../utils/cacheManager');
const { t } = require('../config/i18n');

/**
 * 创建 Feed 路由（用于 /api/）
 */
function createApiFeedRoutes(options) {
  const router = express.Router();
  const { config, gitManager } = options;
  const apiPrefix = (options.baseUrl || '') + '/api/image';

  // RSS Feed
  router.get('/rss.xml', async (req, res) => {
    try {
      const cached = cacheManager.get('rss');
      if (cached) {
        res.setHeader('Content-Type', 'application/xml');
        res.send(cached);
        return;
      }

      const files = await gitManager.getAllMarkdownFiles(config.mdPath);
      const baseUrl = config.siteUrl || req.protocol + '://' + req.get('host');

      const recentFiles = files
        .filter(file => !file.path.endsWith('.pdf'))
        .sort((a, b) => new Date(b.modified) - new Date(a.modified))
        .slice(0, 20);

      let rss = '<?xml version="1.0" encoding="UTF-8"?>\n';
      rss += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
      rss += '  <channel>\n';
      rss += '    <title>' + (config.siteTitle || 'PowerWiki') + '</title>\n';
      rss += '    <link>' + baseUrl + '</link>\n';
      rss += '    <description>' + (config.siteDescription || 'PowerWiki - 一个现代化的知识库系统') + '</description>\n';
      rss += '    <language>zh-CN</language>\n';
      rss += '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n';
      rss += '    <atom:link href="' + baseUrl + '/rss.xml" rel="self" type="application/rss+xml" />\n';

      for (const file of recentFiles) {
        try {
          const content = await gitManager.readMarkdownFile(file.path);
          const parsed = parseMarkdown(content, file.path, apiPrefix);
          const fileInfo = await gitManager.getFileInfo(file.path);
          const fileName = fileInfo.name.replace(/\.(md|markdown)$/i, '');
          const title = fileName || parsed.title || '文章';

          const optimizedHtml = seoHelper.optimizeImageTags(parsed.html, title);
          const description = seoHelper.generateDescription(optimizedHtml, title, 300);

          const articleUrl = baseUrl + '/post/' + encodeURIComponent(file.path);
          const pubDate = new Date(file.modified).toUTCString();

          rss += '    <item>\n';
          rss += '      <title><![CDATA[' + title + ']]></title>\n';
          rss += '      <link>' + articleUrl + '</link>\n';
          rss += '      <description><![CDATA[' + description + ']]></description>\n';
          rss += '      <pubDate>' + pubDate + '</pubDate>\n';
          rss += '      <guid isPermaLink="true">' + articleUrl + '</guid>\n';

          const pathParts = file.path.split('/').filter(p => p && !p.endsWith('.md') && !p.endsWith('.markdown'));
          pathParts.forEach(part => {
            rss += '      <category><![CDATA[' + part + ']]></category>\n';
          });

          rss += '    </item>\n';
        } catch (error) {
          console.warn(`⚠️  ${t('feed.skipArticle')} ${file.path}:`, error.message);
        }
      }

      rss += '  </channel>\n';
      rss += '</rss>';

      cacheManager.set('rss', '', rss, 30 * 60 * 1000);

      res.setHeader('Content-Type', 'application/xml');
      res.send(rss);
    } catch (error) {
      console.error(`❌ ${t('feed.generateRssFailed')}:`, error);
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?><error>${t('feed.generateRssFailed')}</error>`);
    }
  });

  // Sitemap
  router.get('/sitemap.xml', async (req, res) => {
    try {
      const cached = cacheManager.get('sitemap');
      if (cached) {
        res.setHeader('Content-Type', 'application/xml');
        res.send(cached);
        return;
      }

      const files = await gitManager.getAllMarkdownFiles(config.mdPath);
      const baseUrl = config.siteUrl || req.protocol + '://' + req.get('host');

      let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
      sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
      sitemap += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

      sitemap += '  <url>\n';
      sitemap += '    <loc>' + baseUrl + '/</loc>\n';
      sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
      sitemap += '    <changefreq>daily</changefreq>\n';
      sitemap += '    <priority>1.0</priority>\n';
      sitemap += '  </url>\n';

      for (const file of files) {
        if (!file.path.endsWith('.pdf')) {
          const url = baseUrl + '/post/' + encodeURIComponent(file.path);
          const lastmod = new Date(file.modified).toISOString().split('T')[0];

          const daysSinceModified = (Date.now() - new Date(file.modified).getTime()) / (1000 * 60 * 60 * 24);
          let priority = 0.8;
          if (daysSinceModified < 7) {
            priority = 0.9;
          } else if (daysSinceModified < 30) {
            priority = 0.8;
          } else if (daysSinceModified < 90) {
            priority = 0.7;
          } else {
            priority = 0.6;
          }

          sitemap += '  <url>\n';
          sitemap += '    <loc>' + url + '</loc>\n';
          sitemap += '    <lastmod>' + lastmod + '</lastmod>\n';
          sitemap += '    <changefreq>weekly</changefreq>\n';
          sitemap += '    <priority>' + priority.toFixed(1) + '</priority>\n';

          try {
            const content = await gitManager.readMarkdownFile(file.path);
            const parsed = parseMarkdown(content, file.path, apiPrefix);
            if (parsed.html) {
              const images = seoHelper.extractImages(parsed.html, baseUrl);
              images.slice(0, 3).forEach(imgUrl => {
                sitemap += '    <image:image>\n';
                sitemap += '      <image:loc>' + imgUrl + '</image:loc>\n';
                sitemap += '    </image:image>\n';
              });
            }
          } catch (err) {
            // 忽略读取文章失败的情况
          }

          sitemap += '  </url>\n';
        }
      }

      sitemap += '</urlset>';

      cacheManager.set('sitemap', '', sitemap, 60 * 60 * 1000);

      res.setHeader('Content-Type', 'application/xml');
      res.send(sitemap);
    } catch (error) {
      console.error(`❌ ${t('feed.generateSitemapFailed')}:`, error);
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?><error>${t('feed.generateSitemapFailed')}</error>`);
    }
  });

  return router;
}

module.exports = { createApiFeedRoutes };
