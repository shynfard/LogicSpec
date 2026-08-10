/**
 * Initial document shown when the editor opens — the same signup example
 * that `logicspec init` scaffolds, so the canvas starts with a real graph.
 */
export const SEED_YAML = `version: "1"

feature:
  id: signup
  name: Signup
  description: Minimal example feature created by \`logicspec init\`.

start: signup-page

actors:

  visitor:
    kind: user
    label: Visitor

  web:
    kind: frontend
    label: Web App

  accounts:
    kind: service
    label: Accounts Service

context:

  email:
    type: string

  accountId:
    type: string

steps:

  signup-page:
    type: page
    label: Sign Up
    actor: web
    route: /signup
    actions:
      submit:
        label: Create account
        produces:
          - email
        next: create-account

  create-account:
    type: operation
    label: Create Account
    actor: accounts
    call: accounts.create-account
    requires:
      - email
    produces:
      - accountId
    on:
      success:
        next: account-created
      error:
        next: signup-error

  account-created:
    type: event
    label: Account Created
    actor: accounts
    direction: publish
    event: AccountCreated
    next: done

  signup-error:
    type: error
    label: Signup Failed
    message: Could not create the account.
    actions:
      retry:
        label: Try again
        next: signup-page

  done:
    type: final
    label: Account Created
    outcome: success
`;
