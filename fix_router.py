#!/usr/bin/env python3
import re

path = r'C:\Users\ligua\WorkBuddy\trustos\src\services\llm-native-router.ts'
content = open(path, 'r', encoding='utf-8').read()

# Fix 1: callDirectReplyModel signature
old_sig = (
    'async function callDirectReplyModel(input: {\n'
    '  message: string;\n'
    '  history: ChatMessage[];\n'
    '  language: "zh" | "en";\n'
    '  reqApiKey?: string;\n'
    '  crossSessionContext?: string;\n'
    '}): Promise<string> {\n'
    '  const { message, history, language, reqApiKey, crossSessionContext } = input;'
)
new_sig = (
    'async function callDirectReplyModel(input: {\n'
    '  message: string;\n'
    '  history: ChatMessage[];\n'
    '  language: "zh" | "en";\n'
    '  reqApiKey?: string;\n'
    '  reqLlmBaseUrl?: string;\n'
    '  fastModel?: string;\n'
    '  crossSessionContext?: string;\n'
    '}): Promise<string> {\n'
    '  const { message, history, language, reqApiKey, reqLlmBaseUrl, fastModel, crossSessionContext } = input;'
)

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    print('FIX 1: callDirectReplyModel signature OK')
else:
    idx = content.find('async function callDirectReplyModel')
    if idx >= 0:
        print('FIX 1: NOT FOUND - showing actual text:')
        print(repr(content[idx:idx+400]))
    else:
        print('FIX 1: NOT FOUND - function not in file')

# Fix 2: callDirectReplyModel body - standalone function body (NOT the one inside the function definition)
# The pattern: directReplyModel uses config.fastModel, needs fastModel || config.fastModel
# We need to find the second occurrence (first is in callManagerModel which we already fixed)
# Pattern: inside Direct Reply function, after the prompt/messages construction

# The old body pattern in callDirectReplyModel
old_body = (
    '      const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);\n'
    '      return resp.content;\n'
    '    }\n'
    '    const resp = await callModelFull(config.fastModel, messages);\n'
    '    return resp.content;\n'
    '  } catch (e: any) {\n'
    '    console.error("[llm-native-router] Direct reply model call failed:", e.message);\n'
    '    throw e;\n'
    '  }\n'
    '}\n'
    '\n'
    '// ── Gated Delegation'
)
new_body = (
    '      const resp = await callOpenAIWithOptions(fastModel || config.fastModel, messages, reqApiKey, reqLlmBaseUrl || config.openaiBaseUrl || undefined);\n'
    '      return resp.content;\n'
    '    }\n'
    '    const resp = await callModelFull(fastModel || config.fastModel, messages);\n'
    '    return resp.content;\n'
    '  } catch (e: any) {\n'
    '    console.error("[llm-native-router] Direct reply model call failed:", e.message);\n'
    '    throw e;\n'
    '  }\n'
    '}\n'
    '\n'
    '// ── Gated Delegation'
)

if old_body in content:
    content = content.replace(old_body, new_body, 1)
    print('FIX 2: callDirectReplyModel body OK')
else:
    # Try to find the Direct Reply section
    idx = content.find('Direct reply model call failed')
    if idx >= 0:
        print('FIX 2: NOT FOUND - showing context:')
        print(repr(content[idx-300:idx+100]))
    else:
        print('FIX 2: NOT FOUND')

# Fix 3: routeByGatedDecision - add slowModel to RouteContext and use it
old_ctx = (
    'interface RouteContext {\n'
    '  message: string;\n'
    '  user_id: string;\n'
    '  session_id: string;\n'
    '  turn_id: number;\n'
    '  task_id?: string;\n'
    '  language: "zh" | "en";\n'
    '  userFacingText?: string;\n'
    '  reqApiKey?: string;\n'
    '  raw: string;\n'
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
    '  delegation_log_id?: string;\n'
    '}'
)
if old_ctx in content:
    content = content.replace(old_ctx, new_ctx, 1)
    print('FIX 3: RouteContext interface OK')
else:
    idx = content.find('interface RouteContext')
    if idx >= 0:
        print('FIX 3: NOT FOUND - showing:')
        print(repr(content[idx:idx+400]))
    else:
        print('FIX 3: NOT FOUND')

# Fix 4: routeByGatedDecision - pass slowModel to taskPlanner.plan
old_slow = 'model: config.slowModel,'
new_slow = 'model: ctx.slowModel || config.slowModel,'
if old_slow in content:
    content = content.replace(old_slow, new_slow, 1)
    print('FIX 4: taskPlanner.plan slowModel OK')
else:
    idx = content.find('taskPlanner.plan')
    if idx >= 0:
        print('FIX 4: NOT FOUND - showing:')
        print(repr(content[idx-50:idx+200]))
    else:
        print('FIX 4: NOT FOUND')

# Fix 5: routeByGatedDecision call site - add slowModel to context
old_rgd_call = (
    "return routeByGatedDecision(gatedResult, {\n"
    "      message: parsedOutput.userFacingText || message,\n"
    "      userFacingText: parsedOutput.userFacingText,\n"
    "      user_id, session_id, turn_id, language, reqApiKey,\n"
    "      rawOutput: managerOutput, v2Decision\n"
    "  });"
)
new_rgd_call = (
    "return routeByGatedDecision(gatedResult, {\n"
    "      message: parsedOutput.userFacingText || message,\n"
    "      userFacingText: parsedOutput.userFacingText,\n"
    "      user_id, session_id, turn_id, language, reqApiKey,\n"
    "      slowModel,\n"
    "      rawOutput: managerOutput, v2Decision\n"
    "  });"
)
if old_rgd_call in content:
    content = content.replace(old_rgd_call, new_rgd_call, 1)
    print('FIX 5: routeByGatedDecision call site OK')
else:
    idx = content.find('return routeByGatedDecision')
    if idx >= 0:
        print('FIX 5: NOT FOUND - showing:')
        print(repr(content[idx-50:idx+250]))
    else:
        print('FIX 5: NOT FOUND')

# Fix 6: routeByDecision - add slowModel destructure
old_rd_dest = '  const { message, user_id, session_id, language, reqApiKey, raw, delegation_log_id } = ctx;'
new_rd_dest = '  const { message, user_id, session_id, language, reqApiKey, slowModel, raw, delegation_log_id } = ctx;'
if old_rd_dest in content:
    content = content.replace(old_rd_dest, new_rd_dest, 1)
    print('FIX 6: routeByDecision destructure OK')
else:
    idx = content.find('const { message, user_id, session_id, language, reqApiKey, raw')
    if idx >= 0:
        print('FIX 6: NOT FOUND - showing:')
        print(repr(content[idx:idx+200]))
    else:
        print('FIX 6: NOT FOUND')

# Fix 7: routeByDecision call from routeByGatedDecision - add slowModel to ctx spread
old_rd_call = '  return routeByDecision(decision, { ...ctx, raw: rawOutput, delegation_log_id });'
new_rd_call = '  return routeByDecision(decision, { ...ctx, raw: rawOutput, delegation_log_id, slowModel });'
if old_rd_call in content:
    content = content.replace(old_rd_call, new_rd_call, 1)
    print('FIX 7: routeByDecision call site OK')
else:
    idx = content.find('return routeByDecision(decision, { ...ctx')
    if idx >= 0:
        print('FIX 7: NOT FOUND - showing:')
        print(repr(content[idx:idx+150]))
    else:
        print('FIX 7: NOT FOUND')

open(path, 'w', encoding='utf-8').write(content)
print('All done')
