import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";

const blocked = new net.BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) blocked.addSubnet(network, prefix, "ipv6");

export function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 6 && new URL(`http://[${address}]`).hostname.startsWith("[::ffff:")) return false;
  return family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
export function publicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Only public HTTP(S) pages on standard web ports are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/(^|\.)localhost\.?$/i.test(host) || (net.isIP(host) && !isPublicIp(host))) throw new Error("Private network destinations are not allowed.");
  return url;
}
export async function publicAddress(host, resolve = lookup) {
  const addresses = await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error("Private network destinations are not allowed.");
  return addresses[0];
}

// Chrome uses this proxy for every destination; DNS is checked and pinned at connection time.
export async function createEgressProxy() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = publicUrl(req.url);
      if (url.protocol !== "http:") throw new Error("Use CONNECT for HTTPS.");
      const address = await publicAddress(url.hostname);
      const headers = { ...req.headers, host: url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request({ hostname: address.address, family: address.family, port: Number(url.port || 80), method: req.method, path: url.pathname + url.search, headers }, (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(res);
      });
      upstream.on("error", () => res.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403).end("Destination refused.");
    }
  });
  server.on("connect", async (req, socket, head) => {
    try {
      const url = publicUrl(`https://${req.url}`);
      const address = await publicAddress(url.hostname.replace(/^\[|\]$/g, ""));
      const upstream = net.connect({ host: address.address, port: Number(url.port || 443), family: address.family });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
    } catch { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  };
}
