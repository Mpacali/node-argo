const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// --- 环境变量配置 ---
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址,需填写部署Merge-sub项目后的首页地址,例如：https://merge.serv00.net
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url,例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || './tmp';   // 运行目录,sub节点文件保存目录
const SUB_PATH = process.env.SUB_PATH || 'sub';       // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        // http服务订阅端口
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913'; // Vless/Vmess/Trojan 协议的 UUID
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = process.env.ARGO_AUTH || '';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://fscarmen.cloudflare.now.cc
const ARGO_PORT = process.env.ARGO_PORT || 8001;            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = process.env.CFIP || 'www.visa.com.sg';         // 节点优选域名或优选ip
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || 'Vls';                     // 节点名称

// --- 自动获取最新版本号（需要联网获取，或者您手动指定一个版本） ---
// 警告：自动获取最新版本号可能下载到不稳定版本。
// 建议：手动指定一个您确认稳定的版本号，或者实现更健壮的版本获取和筛选逻辑。
let SINGBOX_VERSION = "1.8.0"; // 默认版本，最好根据实际情况修改或动态获取
let CLOUDFLARED_VERSION = "2024.5.1"; // 默认版本，最好根据实际情况修改或动态获取

// 函数来获取最新的 GitHub Release 版本
async function getLatestGitHubRelease(repoOwner, repoName) {
    try {
        const response = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`);
        return response.data.tag_name.replace(/^v/, ''); // 移除 'v' 前缀
    } catch (error) {
        console.warn(`无法获取 ${repoOwner}/${repoName} 的最新版本，将使用默认版本。错误: ${error.message}`);
        return null;
    }
}

// --- 文件路径定义 ---
let webPath = path.join(FILE_PATH, 'web'); // 用于 sing-box
let botPath = path.join(FILE_PATH, 'bot'); // 用于 cloudflared
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// --- 创建运行文件夹 ---
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// --- 如果订阅器上存在历史运行节点则先删除 ---
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line =>
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    return axios.post(`${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((error) => {
      return null;
    });
  } catch (err) {
    return null;
  }
}

// --- 清理历史文件 ---
function cleanupOldFiles() {
  const pathsToDelete = ['web', 'bot', 'sub.txt', 'boot.log'];
  pathsToDelete.forEach(file => {
    const filePath = path.join(FILE_PATH, file);
    fs.unlink(filePath, () => {});
  });
}

// --- 根路由 ---
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// --- 生成 sing-box 配置文件 ---
const config = {
  log: { access: '/dev/null', error: '/dev/null', level: 'warn' },
  inbounds: [
    { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
    { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
    { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
  ],
  dns: { servers: ["https+local://8.8.8.8/dns-query"] },
  outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
};
fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));

// --- 判断系统架构 ---
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm64'; // sing-box 和 cloudflared 通常用 arm64
  } else if (arch === 'x64') {
    return 'amd64'; // sing-box 和 cloudflared 通常用 amd64
  } else {
    console.error(`不支持的架构: ${arch}`);
    process.exit(1);
  }
}

// --- 下载文件 (无校验和) ---
async function downloadFile(fileName, fileUrl, callback) {
    const filePath = path.join(FILE_PATH, fileName);
    const writer = fs.createWriteStream(filePath);

    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', err => {
                fs.unlink(filePath, () => {}); // 删除不完整的文件
                reject(`Download ${fileName} failed: ${err.message}`);
            });
        });

        console.log(`Download ${fileName} successfully from ${fileUrl}`);
        callback(null, fileName);

    } catch (err) {
        callback(`Download ${fileName} failed: ${err.message}. URL: ${fileUrl}`);
    }
}

// --- 根据系统架构返回对应的文件信息和下载 URL ---
function getFilesToDownload(architecture) {
  let filesToDownload = [];

  // Sing-box
  // 假设 sing-box 的 release 文件名格式为 sing-box-${VERSION}-linux-${ARCH}.tar.gz
  const singboxFileName = `sing-box-${SINGBOX_VERSION}-linux-${architecture}.tar.gz`;
  filesToDownload.push({
      fileName: "sing-box.tar.gz", // 先下载为 tar.gz
      execName: "web", // 解压后可执行文件将命名为 web
      fileUrl: `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${singboxFileName}`
  });


  // Cloudflared
  // 假设 cloudflared 的 release 文件名格式为 cloudflared-linux-${ARCH}
  const cloudflaredFileName = `cloudflared-linux-${architecture}`;
  filesToDownload.push({
      fileName: "bot", // 直接下载为 bot
      execName: "bot", // 可执行文件命名为 bot
      fileUrl: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${cloudflaredFileName}`
  });

  return filesToDownload;
}

// --- 下载并运行依赖文件 ---
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();

  // 动态获取最新版本号
  const latestSingboxVersion = await getLatestGitHubRelease('SagerNet', 'sing-box');
  if (latestSingboxVersion) SINGBOX_VERSION = latestSingboxVersion;

  const latestCloudflaredVersion = await getLatestGitHubRelease('cloudflare', 'cloudflared');
  if (latestCloudflaredVersion) CLOUDFLARED_VERSION = latestCloudflaredVersion;

  const filesToDownload = getFilesToDownload(architecture);

  if (filesToDownload.length === 0) {
    console.log(`未找到需要下载的文件.`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, downloadedFileName) => {
        if (err) {
          reject(err);
        } else {
            // 如果是 sing-box 的 tar.gz 文件，需要解压
            if (downloadedFileName === "sing-box.tar.gz") {
                const downloadedFilePath = path.join(FILE_PATH, downloadedFileName);
                const extractDir = path.join(FILE_PATH, 'sing-box-extracted'); // 解压到临时目录
                try {
                    fs.mkdirSync(extractDir, { recursive: true });
                    execSync(`tar -xzf ${downloadedFilePath} -C ${extractDir}`);
                    // 找到解压后的 sing-box 可执行文件（通常在解压目录的根或子目录）
                    // 这里假设解压后文件在 sing-box-extracted/sing-box
                    const singboxExtractedPath = path.join(extractDir, `sing-box-${SINGBOX_VERSION}-linux-${architecture}`, 'sing-box'); // 示例路径，可能需要根据实际解压结构调整
                    if (!fs.existsSync(singboxExtractedPath)) {
                        // 尝试其他常见的解压路径，例如直接在根目录
                        const directPath = path.join(extractDir, 'sing-box');
                        if (fs.existsSync(directPath)) {
                             singboxExtractedPath = directPath;
                        } else {
                            // 如果还是找不到，遍历解压目录
                            const files = fs.readdirSync(extractDir);
                            const found = files.find(f => f.startsWith('sing-box') && !f.includes('.')); // 查找名为 sing-box 或 sing-box-XXX
                            if (found) {
                                singboxExtractedPath = path.join(extractDir, found);
                            } else {
                                console.error("无法在解压目录中找到 sing-box 可执行文件。请检查压缩包内容。");
                                reject("Sing-box executable not found after extraction.");
                                return;
                            }
                        }
                    }

                    fs.renameSync(singboxExtractedPath, path.join(FILE_PATH, 'web')); // 重命名为 web
                    fs.unlinkSync(downloadedFilePath); // 删除 tar.gz 文件
                    execSync(`rm -rf ${extractDir}`); // 删除临时解压目录
                    console.log('Sing-box extracted and renamed to web');
                    resolve(fileInfo.execName);
                } catch (extractErr) {
                    console.error(`解压 Sing-box 时出错: ${extractErr.message}`);
                    reject(extractErr);
                }
            } else {
                resolve(fileInfo.execName);
            }
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('下载或处理文件时出错:', err);
    return;
  }

  // 授权和运行
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(relativeFilePath => {
      const absoluteFilePath = path.join(FILE_PATH, relativeFilePath);
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`文件授权失败 ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`文件授权成功 ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = ['./web', './bot'];
  authorizeFiles(filesToAuthorize);

  // 运行 sing-box
  const command1 = `nohup ${FILE_PATH}/web run -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log('Sing-box is running');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`Sing-box 运行错误: ${error}`);
  }

  // 运行 cloudflared
  if (fs.existsSync(path.join(FILE_PATH, 'bot'))) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${FILE_PATH}/bot ${args} >/dev/null 2>&1 &`);
      console.log('Cloudflared is running');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`执行 Cloudflared 命令时出错: ${error}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

// --- 获取固定隧道 json ---
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN 或 ARGO_AUTH 变量为空, 将使用临时隧道");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2

  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  } else {
    console.log("ARGO_AUTH 不匹配 TunnelSecret, 将使用 token 连接隧道");
  }
}
argoType();

// --- 获取临时隧道 domain ---
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    console.log('使用固定隧道域名:', argoDomain);
    await generateLinks(argoDomain);
  } else {
    try {
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const lines = fileContent.split('\n');
      const argoDomains = [];
      lines.forEach((line) => {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          argoDomains.push(domain);
        }
      });

      if (argoDomains.length > 0) {
        argoDomain = argoDomains[0];
        console.log('提取到的临时隧道域名:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('未找到临时隧道域名, 重新运行 cloudflared 以获取域名');
        // 删除 boot.log 文件，等待 2s 重新运行 server 以获取 ArgoDomain
        fs.unlinkSync(path.join(FILE_PATH, 'boot.log'));
        async function killBotProcess() {
          try {
            await exec('pkill -f "[b]ot" > /dev/null 2>&1');
          } catch (error) {
            // 忽略输出
          }
        }
        killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${path.join(FILE_PATH, 'bot')} ${args} >/dev/null 2>&1 &`);
          console.log('Cloudflared 正在运行.');
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains(); // 重新提取域名
        } catch (error) {
          console.error(`执行 Cloudflared 命令时出错: ${error}`);
        }
      }
    } catch (error) {
      console.error('读取 boot.log 时出错:', error);
    }
  }

  // 生成 list 和 sub 信息
  async function generateLinks(argoDomain) {
    const metaInfo = execSync(
      'curl -s https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'',
      { encoding: 'utf-8' }
    );
    const ISP = metaInfo.trim();

    return new Promise((resolve) => {
      setTimeout(() => {
        const VMESS = { v: '2', ps: `${NAME}-${ISP}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '' };
        const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${NAME}-${ISP}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${NAME}-${ISP}
    `;
        // 打印 sub.txt 内容到控制台
        console.log(Buffer.from(subTxt).toString('base64'));
        fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
        console.log(`${FILE_PATH}/sub.txt saved successfully`);
        uplodNodes();
        // 将内容进行 base64 编码并写入 SUB_PATH 路由
        app.get(`/${SUB_PATH}`, (req, res) => {
          const encodedContent = Buffer.from(subTxt).toString('base64');
          res.set('Content-Type', 'text/plain; charset=utf-8');
          res.send(encodedContent);
        });
        resolve(subTxt);
      }, 2000);
    });
  }
}

// --- 自动上传节点或订阅 ---
async function uplodNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = {
      subscription: [subscriptionUrl]
    };
    try {
        const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200) {
            console.log('订阅上传成功');
        } else {
          return null;
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 400) {
              // console.error('订阅已存在');
            }
        }
    }
  } else if (UPLOAD_URL) {
      if (!fs.existsSync(listPath)) return;
      const content = fs.readFileSync(listPath, 'utf-8');
      const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

      if (nodes.length === 0) return;

      const jsonData = JSON.stringify({ nodes });

      try {
          const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`, jsonData, {
              headers: { 'Content-Type': 'application/json' }
          });
          if (response.status === 200) {
            console.log('节点上传成功');
        } else {
            return null;
        }
      } catch (error) {
          return null;
      }
  } else {
      // console.log('跳过节点上传');
      return;
  }
}

// --- 90s 后删除相关文件 ---
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath, path.join(FILE_PATH, 'sing-box.tar.gz')];

    exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
      console.clear();
      console.log('App is running');
      console.log('感谢您使用此脚本，祝您使用愉快！');
    });
  }, 90000); // 90s
}
cleanFiles();

// --- 自动访问项目 URL ---
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("跳过添加自动访问任务");
    return;
  }

  try {
    const response = await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    // console.log(`${JSON.stringify(response.data)}`);
    console.log(`自动访问任务添加成功`);
  } catch (error) {
    console.error(`添加URL失败: ${error.message}`);
  }
}

// --- 回调运行 ---
async function startserver() {
  deleteNodes();
  cleanupOldFiles();
  await downloadFilesAndRun();
  await extractDomains();
  AddVisitTask();
}
startserver();

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));