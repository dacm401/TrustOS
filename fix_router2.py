path = r'C:\Users\ligua\WorkBuddy\trustos\src\services\llm-native-router.ts'
content = open(path, 'r', encoding='utf-8').read()

# Fix RouteContext - add missing fields
old_ctx = (
    'interface RouteContext {\n'
    '  message: string;\n'
    '  user_id: string;\n'
    '  session_id: string;\n'
    '  language: "zh" | "en";\n'
    '  reqApiKey?: string;\n'
    '  raw: string;\n'
    '  /** G4: delegation_logs 主键 ID（用于异步回写 execution 结果） */\n'
    '  delegation_log_id?: string;\n'
    '}'
)
new_ctx = (
    'interface RouteContext {\n'
    '  message: string;\n'
    '  user_id: string;\n'
    '  session_id: string;\n'
    '  turn_id: number;\n'
    '  task_id?: string;\n'
    '  language: "zh" | "en";\n'
    '  userFacingText?: string;\n'
    '  reqApiKey?: string;\n'
    '  slowModel?: string;\n'
    '  raw: string;\n'
    '  /** G4: delegation_logs 主键 ID（用于异步回写 execution 结果） */\n'
    '  delegation_log_id?: string;\n'
    '}'
)
if old_ctx in content:
    content = content.replace(old_ctx, new_ctx, 1)
    print('FIX 1: RouteContext OK')
else:
    print('FIX 1: RouteContext NOT FOUND')

# Fix routeByGatedDecision call - add slowModel
old_rgd = (
    'return routeByGatedDecision(gatedResult, { \n'
    '      message: parsedOutput.userFacingText || message, \n'
    '      userFacingText: parsedOutput.userFacingText,\n'
    '      user_id, session_id, turn_id, language, reqApiKey, \n'
    '      rawOutput: managerOutput, v2Decision \n'
    '  });'
)
new_rgd = (
    'return routeByGatedDecision(gatedResult, { \n'
    '      message: parsedOutput.userFacingText || message, \n'
    '      userFacingText: parsedOutput.userFacingText,\n'
    '      user_id, session_id, turn_id, language, reqApiKey, \n'
    '      slowModel,\n'
    '      rawOutput: managerOutput, v2Decision \n'
    '  });'
)
if old_rgd in content:
    content = content.replace(old_rgd, new_rgd, 1)
    print('FIX 2: routeByGatedDecision call OK')
else:
    print('FIX 2: routeByGatedDecision call NOT FOUND')
    idx = content.find('return routeByGatedDecision')
    if idx >= 0:
        print(repr(content[idx:idx+350]))

open(path, 'w', encoding='utf-8').write(content)
print('Done')
