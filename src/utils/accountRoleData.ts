export const DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL = "https://zhishui.cc/api/jx3/excel/";

export function validateAccountRoleDataServerUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "角色数据服务器 URL 不能为空";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "角色数据服务器 URL 格式无效";
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    return "角色数据服务器 URL 必须是带主机的 http 或 https 地址";
  }
  if (url.username || url.password) return "角色数据服务器 URL 不能包含用户名或密码";
  if (url.search || url.hash) return "角色数据服务器 URL 不能包含查询参数或片段";
  return null;
}

export function isInsecureRemoteRoleDataServer(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLocaleLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}
