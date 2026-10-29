/** An error whose message is safe and useful to show to the operator. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    override readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}
