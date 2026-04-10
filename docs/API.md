# API 文档

## 基础信息

| 项目 | 值 |
|------|-----|
| 基础 URL | `http://localhost:5000` |
| 认证方式 | HTTP Basic Auth (可选) |
| 数据格式 | JSON |

---

## 认证

部分接口支持 Basic Auth 认证：

```bash
curl -u username:password http://localhost:5000/api/vms
```

通过环境变量配置：
```bash
BASIC_AUTH_CREDENTIALS=admin:password123
```

---

## 接口列表

### 健康检查

#### GET /health

健康检查接口，不需要认证。

**响应：**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-10T12:00:00.000000"
}
```

---

### 虚拟机操作

#### GET /api/vms

获取所有虚拟机的简要信息。

**响应：**
```json
{
  "success": true,
  "vms": [
    {
      "name": "Web Server",
      "server_host": "192.168.1.100",
      "server_name": "ESXi-01",
      "status": "running",
      "memoryMB": 4096,
      "numCpu": 2
    }
  ]
}
```

**状态值：**
- `running` - 运行中
- `stopped` - 已停止
- `suspended` - 已挂起

---

#### GET /api/status

获取所有虚拟机的详细状态。

**响应：**
```json
{
  "success": true,
  "status": {
    "192.168.1.100": {
      "vms": [
        {
          "name": "Web Server",
          "power_state": "poweredOn",
          "connection_state": "connected",
          "guest_state": "running",
          "memoryMB": 4096,
          "numCpu": 2,
          "disk_free_space": 50000000000
        }
      ],
      "server_power_state": "poweredOn"
    }
  }
}
```

---

#### POST /api/vm/start

启动虚拟机。

**请求体：**
```json
{
  "name": "Web Server",
  "server_host": "192.168.1.100"
}
```

**响应：**
```json
{
  "success": true,
  "message": "虚拟机启动任务已提交"
}
```

---

#### POST /api/vm/suspend

挂起虚拟机。

**请求体：**
```json
{
  "name": "Web Server",
  "server_host": "192.168.1.100"
}
```

**响应：**
```json
{
  "success": true,
  "message": "虚拟机挂起任务已提交"
}
```

---

#### POST /api/vm/stop

关闭虚拟机。

**请求体：**
```json
{
  "name": "Web Server",
  "server_host": "192.168.1.100"
}
```

**响应：**
```json
{
  "success": true,
  "message": "虚拟机关机任务已提交"
}
```

---

### 批量操作

#### POST /api/vms/start

批量启动虚拟机。

**请求体：**
```json
{
  "vms": [
    {"name": "VM1", "server_host": "192.168.1.100"},
    {"name": "VM2", "server_host": "192.168.1.100"}
  ],
  "delay": 30
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| vms | array | 虚拟机列表 |
| delay | int | 启动间隔（秒），默认 0 |

**响应：**
```json
{
  "success": true,
  "message": "批量启动任务已提交",
  "count": 2
}
```

---

#### POST /api/vms/suspend

批量挂起虚拟机。

**请求体：**
```json
{
  "vms": [
    {"name": "VM1", "server_host": "192.168.1.100"},
    {"name": "VM2", "server_host": "192.168.1.100"}
  ]
}
```

**响应：**
```json
{
  "success": true,
  "message": "批量挂起任务已提交",
  "count": 2
}
```

---

### 服务器管理

#### GET /api/servers

获取服务器列表。

**响应：**
```json
{
  "success": true,
  "servers": [
    {
      "id": 1,
      "name": "ESXi-01",
      "host": "192.168.1.100",
      "username": "root",
      "status": "connected"
    }
  ]
}
```

---

#### GET /api/servers/detail

获取服务器详细信息。

**响应：**
```json
{
  "success": true,
  "servers": [
    {
      "id": 1,
      "name": "ESXi-01",
      "host": "192.168.1.100",
      "username": "root",
      "status": "connected",
      "hardware": {
        "vendor": "Dell Inc.",
        "model": "PowerEdge R740",
        "cpu_model": "Intel Xeon Gold 5218",
        "cpu_cores": 32,
        "memory_total": 128849018880,
        "memory_usage": 64382588928
      },
      "datastores": [
        {
          "name": "Datastore1",
          "capacity": 1000000000000,
          "free_space": 500000000000
        }
      ],
      "network_info": [
        {
          "name": "vmnic0",
          "mac": "00:11:22:33:44:55",
          "link_speed": "1 Gbps"
        }
      ]
    }
  ]
}
```

---

#### POST /api/server/connect

测试服务器连接。

**请求体：**
```json
{
  "name": "ESXi-01",
  "host": "192.168.1.100",
  "username": "root",
  "password": "password123"
}
```

**响应：**
```json
{
  "success": true,
  "message": "连接成功"
}
```

---

#### DELETE /api/server/{id}

删除服务器。

**响应：**
```json
{
  "success": true,
  "message": "服务器已删除"
}
```

---

### 收藏夹

#### GET /api/favorites

获取收藏夹列表。

**响应：**
```json
{
  "success": true,
  "favorites": [
    {
      "id": 1,
      "name": "开发环境",
      "vms": [
        {"name": "Dev-DB", "server_host": "192.168.1.100"},
        {"name": "Dev-Web", "server_host": "192.168.1.100"}
      ]
    }
  ]
}
```

---

#### POST /api/favorites

创建收藏。

**请求体：**
```json
{
  "name": "开发环境",
  "vms": [
    {"name": "Dev-DB", "server_host": "192.168.1.100"},
    {"name": "Dev-Web", "server_host": "192.168.1.100"}
  ]
}
```

**响应：**
```json
{
  "success": true,
  "message": "收藏已保存"
}
```

---

#### DELETE /api/favorites/{id}

删除收藏。

**响应：**
```json
{
  "success": true,
  "message": "收藏已删除"
}
```

---

### 配置管理

#### GET /api/config

获取应用配置。

**响应：**
```json
{
  "success": true,
  "config": {
    "ip_whitelist_enabled": false,
    "natural_sort": true
  }
}
```

---

#### POST /api/config

更新应用配置。

**请求体：**
```json
{
  "natural_sort": true
}
```

**响应：**
```json
{
  "success": true,
  "message": "配置已更新"
}
```

---

### 错误响应

所有接口的错误响应格式：

```json
{
  "success": false,
  "error": "错误描述信息"
}
```

**HTTP 状态码：**
- `400` - 请求参数错误
- `401` - 需要认证
- `403` - 拒绝访问（IP白名单）
- `404` - 资源不存在
- `429` - 请求过于频繁
- `500` - 服务器内部错误

---

## 速率限制

默认速率限制：
- **200 次/天**
- **50 次/小时**

`/health` 端点不受限制。

超过限制返回 `429` 状态码：

```json
{
  "success": false,
  "error": "请求过于频繁，请稍后再试"
}
```

---

## 示例代码

### Python

```python
import requests

API_BASE = "http://localhost:5000"

# 获取虚拟机列表
response = requests.get(f"{API_BASE}/api/vms")
vms = response.json()

# 启动虚拟机
requests.post(f"{API_BASE}/api/vm/start", json={
    "name": "Web Server",
    "server_host": "192.168.1.100"
})

# 批量启动
requests.post(f"{API_BASE}/api/vms/start", json={
    "vms": [
        {"name": "VM1", "server_host": "192.168.1.100"},
        {"name": "VM2", "server_host": "192.168.1.100"}
    ],
    "delay": 10
})
```

### JavaScript

```javascript
const API_BASE = "http://localhost:5000";

async function getVMs() {
    const response = await fetch(`${API_BASE}/api/vms`);
    return await response.json();
}

async function startVM(name, serverHost) {
    const response = await fetch(`${API_BASE}/api/vm/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, server_host: serverHost })
    });
    return await response.json();
}
```
