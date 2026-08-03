import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// 开发时代理到 bot webhook 端口，可通过环境变量覆盖
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:2341';

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    base: '/settings/',
    root: path.resolve(__dirname),
    build: {
        outDir: path.resolve(__dirname, '../public/settings'),
        emptyOutDir: true,
        sourcemap: false,
    },
    server: {
        // 监听所有网卡，允许局域网（含 10.0.0.0/24）访问，而不仅是 localhost
        host: true,
        port: 5173,
        // 允许以 10.0.0.x 等 Host 头访问（部分环境会做 Host 校验）
        allowedHosts: true,
        proxy: {
            '/api': {
                target: apiTarget,
                changeOrigin: true,
            },
        },
    },
    preview: {
        host: true,
        port: 4173,
        allowedHosts: true,
    },
});
