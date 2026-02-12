# HKUST(GZ) Coffee Order System | 港科大（广州）咖啡点单系统

[![GitHub license](https://img.shields.io/github/license/Pacoshao/hkustgz-coffee-order)](https://github.com/Pacoshao/hkustgz-coffee-order/blob/netlify/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Pacoshao/hkustgz-coffee-order)](https://github.com/Pacoshao/hkustgz-coffee-order/stargazers)

这是一个为香港科技大学（广州）设计的轻量级咖啡在线点单系统。系统支持顾客端自助下单、订单查询，以及管理端进行订单处理和菜单管理。

## 🌟 主要特性

- **双端界面**：简洁明快的顾客端（点单、查单）与功能完善的管理端。
- **国际化支持**：内置中英文双语切换（i18n）。
- **实时管理**：管理员可以实时查看订单、修改状态（制作中、已完成、已取消）。
- **库存与规格**：支持商品库存管理和自定义规格选项（如：冷/热、糖分等）。
- **营业时段**：支持设置特定营业时间，非营业时间自动禁用下单。
- **灵活部署**：支持传统的 Node.js 服务器部署，也兼容 Netlify Serverless 部署。

## 🛠️ 技术栈

- **前端**：HTML5, CSS3, JavaScript (原生，无重型框架，极致轻量)
- **后端**：Node.js, Express
- **数据库**：MySQL
- **平台同步**：支持 Netlify Functions

## 🚀 快速开始

### 1. 环境准备
确保你的环境中已安装：
- Node.js (>= 24.0.0)
- MySQL 数据库

### 2. 数据库配置
1. 创建一个新的 MySQL 数据库。
2. 运行项目根目录下的 [db_setup.sql](db_setup.sql) 来初始化表结构和种子数据。

### 3. 环境变量
在项目根目录创建 `.env` 文件，并配置如下信息：
```env
DB_HOST=your_mysql_host
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database_name
DB_PORT=your_port
ADMIN_PASSWORD=your_admin_secret_password
```

### 4. 安装与运行
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 启动生产服务器
npm start
```
- 访问顾客端(dev)：`http://localhost:8080/`
- 访问管理端(dev)：`http://localhost:8080/admin.html`（需要输入环境变量中设置的 `ADMIN_PASSWORD`）

## 📦 部署到 Netlify

本存储库已针对 Netlify 进行优化。你可以通过将此项目连接到 Netlify 账号实现快速部署。
- 服务器逻辑位于 `netlify/functions/api.js`。
- 配置文件见 `netlify.toml`。

## 📄 开源协议

本项目采用 MIT 协议开源。

---

**Built with ❤️ for HKUST(GZ) community.**

Developed by [@Pacoshao](https://github.com/Pacoshao) | Project: [hkustgz-coffee-order](https://github.com/Pacoshao/hkustgz-coffee-order)
