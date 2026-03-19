#!/bin/bash
# Diva Firewall — Story 1.5
# Block external access to internal services, allow only localhost + dashboard

set -euo pipefail

# Flush existing rules
iptables -F INPUT 2>/dev/null || true

# Allow loopback (localhost)
iptables -A INPUT -i lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH (port 22 or custom)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow WireGuard
iptables -A INPUT -p udp --dport 51820 -j ACCEPT

# Allow dashboard on local network only (port 3002, 3003)
iptables -A INPUT -p tcp --dport 3002 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 3002 -s 172.16.0.0/12 -j ACCEPT
iptables -A INPUT -p tcp --dport 3002 -s 192.168.0.0/16 -j ACCEPT
iptables -A INPUT -p tcp --dport 3003 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 3003 -s 172.16.0.0/12 -j ACCEPT
iptables -A INPUT -p tcp --dport 3003 -s 192.168.0.0/16 -j ACCEPT

# Block all external access to internal service ports
for port in 8080 8880 8881 8882 8883 9002 9010; do
  iptables -A INPUT -p tcp --dport $port -j DROP
done

echo "[FIREWALL] Rules applied — internal services protected"
