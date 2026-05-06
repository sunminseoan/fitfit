export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profile, brand, product } = req.body || {};
  if (!profile) return res.status(400).json({ error: '프로필 정보가 필요합니다' });

  const system = `당신은 아기 옷 사이즈 전문가입니다. 한국 아기 옷 사이즈 체계(50, 60, 70, 80, 90, 100)를 기반으로 사이즈를 추천합니다. 반드시 JSON만 반환하세요. 다른 설명 없이 JSON 객체만 출력하세요.`;

  const brandInfo  = brand   ? ` / 브랜드: ${brand}`   : '';
  const productInfo = product ? ` / 제품명: ${product}` : '';
  const user = `아기 정보: 이름: ${profile.name} / 성별: ${profile.gender === 'girl' ? '여아' : '남아'} / 나이: ${profile.age}개월 / 키: ${profile.height}cm / 몸무게: ${profile.weight}kg${brandInfo}${productInfo}

다음 JSON 형식으로만 답하세요:
{"recommendedSize":"80","fitType":"여유있게 맞음","wearingPeriod":"약 3~4개월","alternativeSize":"90","confidence":94,"comment":"상세 설명 2~3문장"}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return res.status(anthropicRes.status).json({ error: err.error?.message || 'Anthropic API 오류' });
    }

    const data = await anthropicRes.json();
    const text = data.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'AI 응답 형식 오류' });

    return res.json(JSON.parse(match[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message || '서버 오류' });
  }
}
