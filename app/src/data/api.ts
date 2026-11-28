// What the page asks of the server. Each answer is checked against the shared protocol before the page uses it:
// a server that says something else is an error here, not a wrong screen later.
import { ErrorBody, Hello, PROTOCOL_VERSION, REQUESTS, type Params, type RequestName, type Result } from "@shared/protocol.ts"

/** A request the server refused: its status and its words. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function post(name: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  // same origin: the cookie the server set goes with it, and the page never holds the token
  const res = await fetch(`/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const said = ErrorBody.safeParse(body)
    throw new ApiError(res.status, said.success ? said.data.error : `the server answered ${res.status}`)
  }
  return body
}

export async function request<N extends RequestName>(name: N, params: Params<N>, signal?: AbortSignal): Promise<Result<N>> {
  return REQUESTS[name].result.parse(await post(name, params, signal)) as Result<N>
}

/** The first thing said to the server: a server of another protocol refuses (409), and nothing else is asked of it. */
export async function hello(signal?: AbortSignal): Promise<Hello> {
  return Hello.parse(await post("hello", { protocol: PROTOCOL_VERSION }, signal))
}
