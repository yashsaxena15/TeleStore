import requests
import socket
import asyncio

def get_public_ip():
    try:
        response = requests.get('https://api.ipify.org?format=json')
        ip_data = response.json()
        ip = ip_data['ip']
        return ip
    except requests.RequestException as e:
        return None

    
async def check_public_ip_reachable(ip: str, port: int = 8080):
    await asyncio.sleep(1)
    try:
        sock = socket.create_connection((ip, port), timeout=5)
        return True
    except (socket.timeout, socket.error):
        return False