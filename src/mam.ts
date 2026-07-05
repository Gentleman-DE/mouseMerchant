const POINTS_URL = "https://www.myanonamouse.net/jsonLoad.php?snatch_summary=1";
const BUY_URL = "https://www.myanonamouse.net/json/bonusBuy.php";
const USER_AGENT = "mousemerchant/2.0";

export type MamPointsResult = {
  points: number;
  rotatedCookie?: string;
};

export type MamBuyResult = {
  ok: boolean;
  message: string;
  points?: number;
  rotatedCookie?: string;
};

export class MamClient {
  constructor(private readonly timeoutMs: number) {}

  async fetchPoints(mamCookie: string): Promise<MamPointsResult> {
    const response = await this.request(`${POINTS_URL}`, mamCookie);
    const json = await response.json() as Record<string, unknown>;
    const points = Number(json.seedbonus ?? 0);

    if (!Number.isFinite(points) || points < 0) {
      throw new Error("MAM points response did not include a valid seedbonus value.");
    }

    return {
      points,
      rotatedCookie: extractMamCookie(response),
    };
  }

  async buyUpload(mamCookie: string, amountGb: number): Promise<MamBuyResult> {
    const url = new URL(BUY_URL);
    url.searchParams.set("spendtype", "upload");
    url.searchParams.set("amount", String(amountGb));

    const response = await this.request(url.toString(), mamCookie);
    const json = await response.json() as Record<string, unknown>;
    const points = parseOptionalPoints(json.seedbonus);
    const message = typeof json.Message === "string"
      ? json.Message
      : typeof json.msg === "string"
        ? json.msg
        : JSON.stringify(json);

    return {
      ok: response.ok,
      message,
      points,
      rotatedCookie: extractMamCookie(response),
    };
  }

  private async request(url: string, mamCookie: string): Promise<Response> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: `mam_id=${mamCookie}`,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "manual",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MAM request failed with ${response.status}: ${body.slice(0, 200)}`);
    }

    return response;
  }
}

function parseOptionalPoints(value: unknown): number | undefined {
  const points = Number(value);
  if (!Number.isFinite(points) || points < 0) {
    return undefined;
  }
  return points;
}

function extractMamCookie(response: Response): string | undefined {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  for (const item of cookies) {
    const match = item.match(/(?:^|;\s*)mam_id=([^;]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return undefined;
}
