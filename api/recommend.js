export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profile, brand, product, image, url } = req.body || {};
  if (!profile) return res.status(400).json({ error: '프로필 정보가 필요합니다' });

  // ── URL 크롤링 ──
  let crawledBrand = brand || '';
  let crawledProduct = product || '';
  let crawledImage = null;
  let crawledText = '';

  if (url && url.startsWith('http')) {
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (pageRes.ok) {
        const html = await pageRes.text();

        // og:title → 상품명
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogTitle && !crawledProduct) crawledProduct = ogTitle[1].trim();

        // og:site_name → 브랜드
        const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
        if (ogSite && !crawledBrand) crawledBrand = ogSite[1].trim();

        // og:image → 썸네일
        const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (ogImage) crawledImage = ogImage[1].trim();

        // 페이지 텍스트 (사이즈표 등) - 태그 제거 후 일부만
        crawledText = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 3000);
      }
    } catch (e) {
      // 크롤링 실패해도 계속 진행
    }
  }

  const finalBrand   = crawledBrand   || brand   || '';
  const finalProduct = crawledProduct || product || '';

  const system = `당신은 아기 옷 사이즈 전문가입니다.
아기 옷 사이즈 체계는 브랜드마다 다르며 아래 세 가지 방식이 있습니다.
1. 월령/cm 기준: 50, 60, 70, 80, 90, 100 (한국 및 아시아 브랜드 주로 사용)
2. S/M/L 기준: XS, S, M, L, XL (일부 글로벌 브랜드 사용)
3. 연령/cm 병기 기준: 1세(86cm), 2세(92cm), 3세(98cm) 등 (Zara, H&M, Gap 등 글로벌 브랜드 사용)
반드시 입력된 브랜드와 제품의 사이즈 표기 방식을 파악한 후, 그 방식 그대로 추천하세요.
이미지나 페이지 텍스트에 사이즈표가 있으면 최우선으로 참고하세요.
절대 다른 사이즈 체계로 변환하거나 혼용하지 마세요.`;

  const brandInfo   = finalBrand   ? ` / 브랜드: ${finalBrand}`   : '';
  const productInfo = finalProduct ? ` / 제품명: ${finalProduct}` : '';
  const urlInfo     = crawledText  ? `\n\n상품 페이지 텍스트 (사이즈표 참고):\n${crawledText}` : '';

  const textContent = `아기 정보: 이름: ${profile.name} / 성별: ${profile.gender === 'girl' ? '여아' : '남아'} / 나이: ${profile.age}개월 / 키: ${profile.height}cm / 몸무게: ${profile.weight}kg${brandInfo}${productInfo}${urlInfo}
${image ? '첨부된 사이즈표 이미지도 참고해서 ' : ''}다음 JSON 형식으로만 답하세요 (다른 텍스트 없이):
{"recommendedSize":"사이즈","fitType":"여유있게 맞음","wearingPeriod":"약 3~4개월","alternativeSize":"다음 사이즈","confidence":85,"comment":"한 줄 코멘트","detectedBrand":"감지된 브랜드명","detectedProduct":"감지된 상품명"}`;

  let userContent;
  if (image) {
    const matches = image.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: matches[1], data: matches[2] } },
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

    const result = JSON.parse(match[0]);

    // 크롤링된 정보 추가해서 반환
    return res.json({
      ...result,
      crawledBrand:   crawledBrand   || result.detectedBrand   || '',
      crawledProduct: crawledProduct || result.detectedProduct || '',
      crawledImage:   crawledImage   || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || '서버 오류' });
  }
}
