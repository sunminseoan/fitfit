export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profile, brand, product, image } = req.body || {};
  if (!profile) return res.status(400).json({ error: '프로필 정보가 필요합니다' });

  const system = `당신은 아기 옷 사이즈 전문가입니다.
아기 옷 사이즈 체계는 브랜드마다 다르며 아래 세 가지 방식이 있습니다.
1. 월령/cm 기준: 50, 60, 70, 80, 90, 100 (한국 및 아시아 브랜드 주로 사용)
2. S/M/L 기준: XS, S, M, L, XL (일부 글로벌 브랜드 사용)
3. 연령/cm 병기 기준: 1세(86cm), 2세(92cm), 3세(98cm) 등 (Zara, H&M, Gap 등 글로벌 브랜드 사용)
반드시 입력된 브랜드와 제품의 사이즈 표기 방식을 파악한 후, 그 방식 그대로 추천하세요.
이미지가 첨부된 경우 이미지의 사이즈표를 최우선으로 참고하세요.
절대 다른 사이즈 체계로 변환하거나 혼용하지 마세요.`;

  const brandInfo = brand ? ` / 브랜드: ${brand}` : '';
  const productInfo = product ? ` / 제품명: ${product}` : '';
  const textContent = `아기 정보: 이름: ${profile.name} / 성별: ${profile.gender === 'girl' ? '여아' : '남아'} / 나이: ${profile.age}개월 / 키: ${profile.height}cm / 몸무게: ${profile.weight}kg${brandInfo}${productInfo}
${image ? '첨부된 사이즈표 이미지를 참고해서 ' : ''}다음 JSON 형식으로만 답하세요 (다른 텍스트 없이):
{"recommendedSize":"사이즈","fitType":"여유있게 맞음","wearingPeriod":"약 3~4개월","alternativeSize":"다음 사이즈","confidence":85,"comment":"한 줄 코멘트"}`;

  // 이미지가 있으면 vision용 content 배열, 없으면 텍스트만
  let userContent;
  if (image) {
    // image는 "data:image/jpeg;base64,xxxx" 형태
    const matches = image.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      const mediaType = matches[1];
      const base64Data = matches[2];
      userContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        },
        { type: 'text', text: textContent },
      ];
    } else {
      userContent = textContent;
    }
  } else {
    userContent = textContent;
  }

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
        messages: [{ role: 'user', content: userContent }],
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
