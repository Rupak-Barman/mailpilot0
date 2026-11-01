// config/network.js
import dns from "node:dns";

if (process.env.PREFER_IPV4 !== "false") {
  dns.setDefaultResultOrder("ipv4first");
}

export default dns;

