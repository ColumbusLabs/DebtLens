# frozen_string_literal: true

class AccountsController < ApplicationController
  def index
    render json: { ok: true }
  end

  def show
    render json: { ok: true }
  end

  def create
    render json: { ok: true }
  end

  def update
    render json: { ok: true }
  end

  def destroy
    render json: { ok: true }
  end

  def archive
    render json: { ok: true }
  end

  def restore
    render json: { ok: true }
  end

  def events
    render json: { ok: true }
  end

  def create_event
    render json: { ok: true }
  end

  def export
    render json: { ok: true }
  end

  def import
    render json: { ok: true }
  end

  private

  def account_params
    params.require(:account).permit(:name)
  end
end
