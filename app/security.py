import ipaddress
import socket

def is_private_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_reserved
    except:
        return False

def ip_in_subnet(ip_str, subnet_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        network = ipaddress.ip_network(subnet_str, strict=False)
        return ip in network
    except:
        return False

def get_client_ip(request):
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    if request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    return request.remote_addr

def is_ip_allowed(request, config):
    client_ip = get_client_ip(request)

    if is_private_ip(client_ip):
        return True, client_ip

    allowed_networks = config.get('allowed_networks', [])
    for network in allowed_networks:
        if network and network.strip():
            if ip_in_subnet(client_ip, network.strip()):
                return True, client_ip

    return False, client_ip
