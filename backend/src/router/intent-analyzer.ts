import type { IntentType } from "../types/index.js";
import { config } from "../config.js";

// ── 原有正则规则保留，作为降级方案 ─────────────────────────────────────────────

const INTENT_PATTERNS: { intent: IntentType; patterns: RegExp[] }[] = [
  // 1. MATH — 严格限定数学场景，避免"统计报告""向量数据库"等误触发
  { intent: "math", patterns: [
    // 严格数学运算词（排除"计算机""统计报告""向量数据库"等复合词）
    /(?<![计算机软硬件向量数据])(?:求解|方程|积分|微分|概率论|统计学|矩阵运算|线性代数|几何证明|数列|极限|导数)/i,
    // 矩阵+特征值/特征向量（线性代数）
    /矩阵.{0,10}(特征值|特征向量|行列式|逆矩阵|转置)|特征值.{0,10}特征向量/i,
    // 求解这个微分方程 / 计算这个矩阵（明确数学操作）
    /(计算|求解).{0,10}(矩阵|行列式|特征值|特征向量|微分方程|积分|极限)/i,
    // 单独的"证明"+"定理/公式/猜想"
    /证明.{0,20}(定理|猜想|公式|命题|引理)/i,
    // 纯数字运算式（不是"1+1等于几"这种口算）
    /\d+\s*[\+\-\*\/\^]\s*\d+.{0,10}(求解|化简|展开|因式|证明)/i,
    // 明确的数学符号
    /[∫∑∏√∂∇]|dy\/dx|d[xyt]\/d[xyt]|∞/,
    // 英文严格数学词
    /\b(integral|derivative|eigenvalue|eigenvector|differential equation|lagrangian|gradient descent|convex optimization)\b/i,
    // 拉格朗日/费马/黎曼等专有数学词
    /拉格朗日乘数|费马小定理|黎曼猜想|欧拉公式|泰勒展开|傅里叶变换|贝叶斯定理/i,
  ]},

  // 2. CODE — 必须有代码操作动词或代码标志
  { intent: "code", patterns: [
    /写[一个]*代码|编写代码|实现[一个]*(函数|算法|类|接口)|写[一个]*(函数|脚本|程序|组件)/i,
    /debug|调试|报错|bug|fix.*代码|代码.*错误|编译错误|运行错误/i,
    /```[\s\S]|def \w+\(|function \w+\(|class \w+[:{]/,
    /import \w+|from \w+ import|require\(|npm install|pip install/i,
    /(python|javascript|typescript|java|rust|golang|c\+\+|swift).{0,15}(写|实现|编写|代码|函数|脚本|程序)/i,
    /(write|implement|build|create).{0,15}(function|class|script|program|api|component|module)/i,
    /数据结构|时间复杂度|空间复杂度|递归|迭代|排序算法|搜索算法|动态规划/i,
    // 系统设计 / 架构设计（排除 "评估采用X架构的利弊" 和 "关于X架构你了解多少" 这类 reasoning）
    /设计.{0,20}(系统|架构|数据库|接口|服务|模块|框架|方案)/i,
    /(?<!评估采用)(?<!关于)(分布式|微服务|缓存|负载均衡).{0,15}(系统|架构|设计|实现)/i,
    // 代码审查 / SQL优化
    /review.{0,15}(code|codebase)|代码审查|code review/i,
    /优化.{0,15}(SQL|查询|性能|索引)|SQL.{0,15}(优化|性能|查询)/i,
    // 红黑树 / B树等具体数据结构实现
    /(红黑树|AVL树|B\+?树|跳表|布隆过滤器).{0,15}(实现|插入|删除|操作|算法)/i,
    /实现.{0,20}(红黑树|AVL树|B\+?树|哈希表|链表|二叉树|堆)/i,
  ]},

  // 3. TRANSLATION — 明确翻译动词
  { intent: "translation", patterns: [
    /翻译|translate|英译中|中译英/i,
    /用[中英日韩法德]文(说|写|表达)/i,
    // "用日语说谢谢" / "用法语念一下"
    /^用.{0,5}(语|文).{0,20}(说|写|念|表达|怎么说)/i,
  ]},

  // 4. SUMMARIZATION — 明确总结动词
  { intent: "summarization", patterns: [
    /总结|概括|摘要|归纳|提炼|要点|深度总结|summarize|summary|tl;?dr|核心观点|方法论|结论提取/i,
  ]},

  // 5. REASONING — 分析推理（放 RESEARCH 之前，避免 reasoning 被 research 宽泛正则吃掉）
  { intent: "reasoning", patterns: [
    /为什么|原因是|如何理解|深入分析|本质上|从.*角度|利弊|优缺点/i,
    /比较.{0,20}(区别|差异|优劣)|有什么(区别|不同|优势|劣势)/i,
    /why |how does|what causes|explain|analyze|evaluate|compare/i,
    /pros and cons|trade.?off|versus|vs\.|better than/i,
    // 解释(一下) X 和 Y 的区别/关系/原理
    /解释.{0,8}(一下)?.{0,20}(区别|差异|不同|优缺点|关系|原理|和.{1,20}的)/i,
    // "告诉我X和Y是什么，它们的区别" — 多约束
    /告诉我.{0,30}(区别|差异|不同|优劣|关系)/i,
    // "关于X，你了解多少？" — open-ended 探索
    /^关于.{2,60}[，,？?].{0,20}(了解|知道|说说|介绍|讲讲|多少)/i,
    // 影响机制/影响分析
    /影响.{0,20}(机制|原因|逻辑|路径|结果)/i,
    // 技术/架构决策分析（"评估采用X的利弊"）
    /评估.{0,20}(利弊|优缺|方案|架构|技术)|决策框架/i,
    // "用表格对比A和B" — 对比分析，归为 reasoning
    /用表格.{0,10}(对比|比较).{0,30}/i,
    // 分析 + 降息/利率/货币/政策 + 影响机制
    /分析.{0,20}(降息|升息|货币|利率|政策).{0,20}(影响|机制|效果|结果)/i,
    // 分析 + 竞争格局 + 具体公司（benchmark 归为 reasoning 的深度分析）
    /分析.{0,40}(竞争格局|市场份额|市场变化).{0,20}(包括|英伟达|AMD|英特尔|苹果|谷歌|微软)/i,
  ]},

  // 6. RESEARCH — 有明确"搜索/查找/调研/调查"动词，或市场行业研究词组
  { intent: "research", patterns: [
    /调研|综述|市场分析|竞争分析|行业分析|竞争格局|发展趋势|市场格局/i,
    /research report|market analysis|competitive landscape|industry overview/i,
    // "搜索/查找/查询/检索 + 主题" — 明确检索意图
    /^(搜索|查找|查询|检索).{2,}/i,
    // 行业/市场研究词组（近年/当前 + 市场竞争）
    /(2024|2025|近年|最近几年|当前|目前).{0,20}(市场|行业|竞争|格局|趋势)/i,
    /全球.{0,15}(市场|行业)|市场.{0,15}(份额|规模)/i,
    // 学术文献检索
    /(近五年|近三年|最新|最近).{0,10}(论文|研究|文献|成果|进展)/i,
    // 调查+产品对比（调研型）
    /调查.{0,30}(产品|工具|方案).{0,20}(对比|性能|特点|场景)/i,
    // 调研+应用/现状
    /调研.{0,30}(应用|现状|进展|发展)/i,
    // 搜索+政策/趋势
    /搜索.{0,20}(政策|趋势|标准|规范|法规)/i,
  ]},

  // 7. CREATIVE — 创作类（帮我 + 写 + 体裁，前缀更宽松，体裁前允许修饰语）
  { intent: "creative", patterns: [
    // 写 + (一首/一篇...) + (修饰语) + 体裁（允许"帮我写一首关于春天的诗"）
    /.{0,15}写.{0,30}(诗|歌词|故事|小说|散文|文章|剧本|对联|笑话|段子)(?![^，。？！]{0,10}(代码|程序|算法))/i,
    /创作.{0,5}(一首|一篇|一段|一个)|编写.{0,5}(一首|一篇)/i,
    /文案|广告语|slogan|标语|起名|命名/i,
    // 应用写作（辞职信/邮件/简历等）
    /.{0,15}写.{0,5}(一封|封|份)?(辞职信|求职信|感谢信|道歉信|邀请函|简历)/i,
    /write a (poem|story|essay|song|script|novel|joke|letter|email)/i,
    /compose|creative writing|brainstorm/i,
    // 品牌/logo创意
    /(品牌|logo|设计).{0,10}(创意|概念|方案|风格)/i,
    // 营销文案 — 英文
    /marketing (copy|content|material)|copywriting/i,
    // "Write a compelling..." 等营销/创意写作句式
    /write.{0,10}(compelling|creative|engaging|catchy)/i,
  ]},

  // 8. SIMPLE_QA — 定义/事实查询（严格匹配，防止 reasoning 被吃掉）
  { intent: "simple_qa", patterns: [
    // "X是什么" — 仅单个对象，不含"区别/比较/原因"等
    /^(?!.*(写|实现|编写|debug|代码|区别|差异|比较|原因|为什么|影响|解释|告诉我.{0,20}区别)).{0,50}(是什么|是谁|指的是|的定义|什么叫).{0,20}[？?]?\s*$/i,
    // 简单事实（在哪/多少钱/几点/几号）— 加"了"的变形
    /^.{0,40}(在哪里?|多少钱?|几个|几点(钟)?(了)?|多久|哪里有|现在几点|今天几号|现在是几点)[？?]?\s*$/i,
    // 是非题
    /^.{0,50}(是吗|对吗|是不是|有没有|能不能|可以吗|是否)[？?]?\s*$/i,
    // 英文定义/事实类（单个对象，排除 "What's the weather" 这类闲聊）
    /^(what is|who is|what's (?!the weather|up)|who's|define|is it|can i|does it).{0,50}[?]?\s*$/i,
    // 口算（1+1等于几）
    /^\d+\s*[\+\-\*×÷\/]\s*\d+.{0,10}(等于几|是多少|得多少|等于多少)[？?]?\s*$/i,
    // "北京是中国的首都吗" 这类是非句
    /^.{0,30}是.{1,15}(的首都|的省会|的首都吗|是哪个国家|属于哪|属于什么)[？?]?\s*$/i,
    // "帮我分析一下这个词的意思" — 分析词义（简单定义查询）
    /^(帮我)?(分析|解释|讲解)(一下)?.{0,20}(词|字|词语|概念|术语|这个|这个词).{0,10}(意思|含义|意义)[？?]?\s*$/i,
  ]},

  // 9. CHAT — 闲聊（最后兜底）
  { intent: "chat", patterns: [
    // 打招呼 / 道别 / 感谢
    /^(你好|hi|hello|hey|嗨|早上好|晚上好|谢谢|感谢|再见|拜拜|哈哈|哦|啊|嗯|好的|明白|ok)/i,
    /how are you|what's up|good morning|good night|thank you|thanks|bye/i,
    // 天气/日常闲聊（英文 "What's the weather like?" 在此捕获）
    /今天天气|how('s| is) the weather|what's the weather/i,
    // 情绪/状态表达
    /累了|好累|有点累|很累|太累|累死了|好困|太困|疲惫|困倦/i,
    /开心|高兴|快乐|难过|伤心|郁闷|烦恼|心情不好|心情好|压力大/i,
    /无聊|闲着|发呆|放松|休息一下|好烦|烦死了|好气|生气|气死了/i,
    /焦虑|担心|害怕|紧张|兴奋|期待|惊喜|失望|沮丧|委屈/i,
    // 简短闲聊句式
    /最近怎么样|你最近|有什么好玩|随便聊|陪我聊|无聊了|聊聊天/i,
    /^.{1,10}(啊|呢|呀|嘛|哦|吧|哎|唉|诶)[！!。.？?]?\s*$/i,
    // 今天/最近 + 情感/日常状态（短句）
    /^(今天|最近|昨天|这几天).{0,15}(好|很|有点|太|真|真的|感觉).{0,10}(累|困|烦|忙|开心|难过|爽|差)[！!。.？?]?\s*$/i,
  ]},
];

export function analyzeIntent(query: string): IntentType {
  const trimmed = query.trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) return intent;
    }
  }
  return "unknown";
}

export function hasCode(query: string): boolean {
  return /```|function |def |class |import |const |let |var |print\(|console\./.test(query);
}

export function hasMath(query: string): boolean {
  return /[∫∑∏√∂∇]|\d+\s*[\+\-\*\/\^]\s*\d+|方程|积分|矩阵|equation|integral|matrix/.test(query);
}

// ── 新增：LLM-based Intent Classifier ─────────────────────────────────────────

const INTENT_CLASSIFIER_PROMPT = `你是一个意图分类器。根据用户消息，输出最匹配的意图类型。

只能输出以下9个词之一，不要输出任何其他内容：
chat
simple_qa
translation
summarization
code
math
reasoning
creative
research

判断规则（重要示例）：
- chat：打招呼、闲聊、情绪表达、简短回应（"嗯""好的""继续""今天好累"）
- simple_qa：问一个具体事实或定义，答案简短。包含：X是什么/叫什么/在哪/多少钱/几岁了/几点/现在几点/1+1等于几
- translation：要求翻译内容
- summarization：要求总结/概括某段内容
- code：要求写代码、调试、实现算法、给代码找bug
- math：数学公式、方程求解、微积分、概率统计推导（不是"1+1等于几"这种简单口算）
- reasoning：需要分析、比较、推理、解释原因
- creative：写作、创作、文案、起名
- research：市场调研、行业分析、综述类问题`;

export async function analyzeIntentWithLLM(
  query: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<IntentType> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INTENT_CLASSIFIER_PROMPT },
          { role: "user", content: query },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      // API 调用失败，降级到正则
      return analyzeIntent(query);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const result = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    
    const validIntents: IntentType[] = [
      "chat", "simple_qa", "translation", "summarization",
      "code", "math", "reasoning", "creative", "research",
    ];

    if (validIntents.includes(result as IntentType)) {
      return result as IntentType;
    }
    // LLM 输出不在合法范围内，降级到正则
    return analyzeIntent(query);
  } catch {
    // 任何错误都降级到正则
    return analyzeIntent(query);
  }
}
