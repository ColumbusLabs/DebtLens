Rails.application.routes.draw do
  get "/accounts", to: "accounts#index"
  post "/accounts", to: "accounts#create"
  get "/accounts/:id", to: "accounts#show"
  patch "/accounts/:id", to: "accounts#update"
  delete "/accounts/:id", to: "accounts#destroy"
  post "/accounts/:id/archive", to: "accounts#archive"
  post "/accounts/:id/restore", to: "accounts#restore"
  get "/accounts/:id/events", to: "accounts#events"
  post "/accounts/:id/events", to: "accounts#create_event"
  resources :invoices
  resources :receipts, only: [:index, :show, :create]
end
