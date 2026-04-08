# Docker 镜像自动构建配置指南

## 概述

本项目配置了 GitHub Actions 自动构建 Docker 镜像，构建完成后可从 Docker Hub 或 GitHub Container Registry 下载。

## 镜像地址

### Docker Hub
```
# 镜像格式
docker.io/<username>/esxi-vm-manager

# 示例
docker.io/yourusername/esxi-vm-manager
```

### GitHub Container Registry
```
# 镜像格式
ghcr.io/<owner>/esxi-vm-manager

# 示例
ghcr.io/yourusername/esxi-vm-manager
```

---

## 配置步骤

### 方式一：使用 Docker Hub（推荐）

#### 1. 创建 Docker Hub 账号

访问 https://hub.docker.com/ 注册账号

#### 2. 创建 Repository

在 Docker Hub 创建仓库，命名为 `esxi-vm-manager`

#### 3. 获取 Access Token

1. 登录 Docker Hub
2. 进入 Account Settings → Security
3. 点击 "New Access Token"
4. 输入描述（如 "GitHub Actions"）
5. 复制生成的 Token

#### 4. 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 值 |
|------------|-----|
| `DOCKERHUB_USERNAME` | 你的 Docker Hub 用户名 |
| `DOCKERHUB_TOKEN` | 刚才创建的 Access Token |

#### 5. 修改 workflow 文件

编辑 `.github/workflows/docker-publish.yml`，将：
```yaml
IMAGE_NAME: ${{ secrets.DOCKERHUB_USERNAME }}/esxi-vm-manager
```

改为你的镜像完整名称：
```yaml
IMAGE_NAME: 你的用户名/esxi-vm-manager
```

---

### 方式二：使用 GitHub Container Registry

#### 1. 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 值 |
|------------|-----|
| 无需额外 secrets | 使用 `GITHUB_TOKEN` 自动认证 |

#### 2. 推送镜像

GitHub Container Registry 使用 `GITHUB_TOKEN` 自动认证，无需手动配置。

---

## 触发构建

### 自动触发

推送代码到 `main` 分支时会自动构建：
```bash
git push origin main
```

### 打标签发布

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 手动触发

在 GitHub 仓库 Actions 页面，点击 "Build and Push to GitHub Container Registry" → "Run workflow"

---

## 下载和使用镜像

### Docker Hub 镜像

```bash
# 拉取 latest 版本
docker pull yourusername/esxi-vm-manager:latest

# 拉取指定版本
docker pull yourusername/esxi-vm-manager:v1.0.0

# 运行
docker run -d \
  --name esxi-vm-manager \
  -p 5000:5000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/logs:/app/logs \
  yourusername/esxi-vm-manager:latest
```

### GitHub Container Registry 镜像

```bash
# 登录 GHCR（仅需首次）
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# 拉取镜像
docker pull ghcr.io/username/esxi-vm-manager:latest

# 运行
docker run -d \
  --name esxi-vm-manager \
  -p 5000:5000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/logs:/app/logs \
  ghcr.io/username/esxi-vm-manager:latest
```

---

## 多架构支持

workflow 已配置支持以下架构：
- `linux/amd64` - Intel/AMD 64位
- `linux/arm64` - ARM 64位（支持树莓派、NAS等）

---

## 故障排除

### 问题：构建失败 "unauthorized: authentication required"

**原因**：Docker Hub 凭据配置错误

**解决**：
1. 确认 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN` 正确
2. 确认 Token 有 push 权限

### 问题：构建失败 "denied: requested access to the resource is denied"

**原因**：镜像仓库不存在或无权限

**解决**：
1. 确认 Docker Hub 仓库已创建
2. 确认用户名匹配

### 问题：镜像拉取失败

**解决**：
```bash
# 清理本地镜像缓存
docker image prune -a

# 重新拉取
docker pull yourusername/esxi-vm-manager:latest
```

---

## 快速开始（无需配置）

如果只想快速使用，而不需要自动构建，可以直接使用我提供的通用镜像：

```bash
# 使用社区通用镜像
docker run -d \
  --name esxi-vm-manager \
  -p 5000:5000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/logs:/app/logs \
  linuxserver/docker-socket-proxy:latest
```

然后手动构建本地镜像：
```bash
git clone <repo-url>
cd ESXi-VM-Manager-Web
docker build -t esxi-vm-manager .
```
