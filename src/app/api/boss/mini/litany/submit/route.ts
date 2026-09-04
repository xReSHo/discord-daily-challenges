import { miniSubmit } from "../../_shared";

export async function POST(request: Request) {
  return miniSubmit("litany", request);
}
