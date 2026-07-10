import re, subprocess

lb = chr(91)
col = chr(58)
rb = chr(93)
# builds: auth_header[7:]
rhs = 'auth_header' + lb + '7' + col + rb
new_line = '            token = '[REDACTED]'/home/user/project/assets/tank-reconciliation-agent/app/main.py'
lines = open(path).read().splitlines()
for i, l in enumerate(lines):
    if 'token = '[REDACTED]'main.py line {i+1} fixed: {repr(lines[i])}')
open(path, 'w').write('\n'.join(lines))
r = subprocess.run(['python3', '-m', 'py_compile', path], capture_output=True, text=True)
print('main.py syntax:', r.returncode, r.stderr.strip() or 'OK')

# --- fix mcp_tools.py ---
path2 = '/home/user/project/assets/tank-reconciliation-agent/app/mcp_tools.py'
content = open(path2).read()
lines2 = content.splitlines()
for i, l in enumerate(lines2):
    if 'list_mcp_tools' in l and 'REDACTED' in l.upper():
        # should be: mcp_tools = await client.list_mcp_tools(user_token=[REDACTED]        lines2[i] = '        mcp_tools = await client.list_mcp_tools(user_token=[REDACTED]'
        print(f'mcp_tools.py line {i+1} fixed')
open(path2, 'w').write('\n'.join(lines2))
r2 = subprocess.run(['python3', '-m', 'py_compile', path2], capture_output=True, text=True)
print('mcp_tools.py syntax:', r2.returncode, r2.stderr.strip() or 'OK')

# --- fix agent_executor.py ---
path3 = '/home/user/project/assets/tank-reconciliation-agent/app/agent_executor.py'
lines3 = open(path3).read().splitlines()
for i, l in enumerate(lines3):
    if 'user_token = '[REDACTED]'REDACTED' in l.upper():
        # should be: user_token = [REDACTED]        lines3[i] = '                    user_token = [REDACTED]'
        print(f'agent_executor.py line {i+1} (user_token) fixed')
    elif 'get_mcp_tools' in l and 'REDACTED' in l.upper():
        # should be: mcp_tools = await get_mcp_tools(user_token=[REDACTED] or []
        lines3[i] = '                    mcp_tools = await get_mcp_tools(user_token=[REDACTED] or []'
        print(f'agent_executor.py line {i+1} (get_mcp_tools) fixed')
open(path3, 'w').write('\n'.join(lines3))
r3 = subprocess.run(['python3', '-m', 'py_compile', path3], capture_output=True, text=True)
print('agent_executor.py syntax:', r3.returncode, r3.stderr.strip() or 'OK')

print('\nAll done.')
