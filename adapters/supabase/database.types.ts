export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  private: {
    Tables: {
      account_deletions: {
        Row: {
          completed_at: string | null;
          created_at: string;
          deletion_status_token_hmac: string;
          expires_at: string;
          id: string;
          requested_at: string;
          safe_failure_code: string | null;
          status: string;
          updated_at: string;
          user_id: string | null;
          user_id_hmac: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          deletion_status_token_hmac: string;
          expires_at: string;
          id?: string;
          requested_at?: string;
          safe_failure_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          user_id_hmac: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          deletion_status_token_hmac?: string;
          expires_at?: string;
          id?: string;
          requested_at?: string;
          safe_failure_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          user_id_hmac?: string;
        };
        Relationships: [];
      };
      ai_operations: {
        Row: {
          completed_at: string | null;
          created_at: string;
          essay_id: string | null;
          estimated_cost_cents: number;
          final_cost_cents: number | null;
          id: string;
          idempotency_key_hmac: string;
          input_tokens: number | null;
          latency_ms: number | null;
          method: string;
          model_id: string | null;
          original_http_status: number | null;
          output_tokens: number | null;
          provider_request_id: string | null;
          provider_started_at: string | null;
          purpose: string;
          request_hmac: string | null;
          result_resource_id: string | null;
          result_resource_type: string | null;
          route: string;
          safe_error_code: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          essay_id?: string | null;
          estimated_cost_cents: number;
          final_cost_cents?: number | null;
          id?: string;
          idempotency_key_hmac: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          method: string;
          model_id?: string | null;
          original_http_status?: number | null;
          output_tokens?: number | null;
          provider_request_id?: string | null;
          provider_started_at?: string | null;
          purpose: string;
          request_hmac?: string | null;
          result_resource_id?: string | null;
          result_resource_type?: string | null;
          route: string;
          safe_error_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          essay_id?: string | null;
          estimated_cost_cents?: number;
          final_cost_cents?: number | null;
          id?: string;
          idempotency_key_hmac?: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          method?: string;
          model_id?: string | null;
          original_http_status?: number | null;
          output_tokens?: number | null;
          provider_request_id?: string | null;
          provider_started_at?: string | null;
          purpose?: string;
          request_hmac?: string | null;
          result_resource_id?: string | null;
          result_resource_type?: string | null;
          route?: string;
          safe_error_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      auth_request_limits: {
        Row: {
          created_at: string;
          key_hmac: string;
          request_count: number;
          scope: string;
          updated_at: string;
          window_end: string;
          window_start: string;
        };
        Insert: {
          created_at?: string;
          key_hmac: string;
          request_count?: number;
          scope: string;
          updated_at?: string;
          window_end: string;
          window_start: string;
        };
        Update: {
          created_at?: string;
          key_hmac?: string;
          request_count?: number;
          scope?: string;
          updated_at?: string;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      beta_cohort_state: {
        Row: {
          accepted_count: number;
          created_at: string;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          accepted_count?: number;
          created_at?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          accepted_count?: number;
          created_at?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      beta_invitations: {
        Row: {
          accepted_user_id: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          invite_token_hmac: string | null;
          normalized_email_hmac: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_user_id?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          invite_token_hmac?: string | null;
          normalized_email_hmac: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_user_id?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          invite_token_hmac?: string | null;
          normalized_email_hmac?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      checkout_sessions: {
        Row: {
          binding_id: string;
          checkout_url: string | null;
          created_at: string;
          expected_amount_cents: number;
          expected_currency: string;
          expected_price_id: string;
          idempotency_key_hmac: string;
          mode: string;
          provider_expires_at: string;
          request_hmac: string;
          season: string;
          status: string;
          stripe_charge_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_payment_intent_id: string | null;
          updated_at: string;
          user_binding_hmac: string;
          user_id: string;
        };
        Insert: {
          binding_id: string;
          checkout_url?: string | null;
          created_at?: string;
          expected_amount_cents: number;
          expected_currency: string;
          expected_price_id: string;
          idempotency_key_hmac: string;
          mode: string;
          provider_expires_at: string;
          request_hmac: string;
          season: string;
          status?: string;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string | null;
          updated_at?: string;
          user_binding_hmac: string;
          user_id: string;
        };
        Update: {
          binding_id?: string;
          checkout_url?: string | null;
          created_at?: string;
          expected_amount_cents?: number;
          expected_currency?: string;
          expected_price_id?: string;
          idempotency_key_hmac?: string;
          mode?: string;
          provider_expires_at?: string;
          request_hmac?: string;
          season?: string;
          status?: string;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string | null;
          updated_at?: string;
          user_binding_hmac?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      stripe_events: {
        Row: {
          binding_id: string | null;
          created_at: string;
          event_id: string;
          event_type: string;
          operator_alert_required: boolean;
          payload_hmac: string;
          processed_at: string | null;
          provider_created_at: string;
          received_at: string;
          safe_failure_code: string | null;
          status: string;
          stripe_charge_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_payment_intent_id: string | null;
          updated_at: string;
        };
        Insert: {
          binding_id?: string | null;
          created_at?: string;
          event_id: string;
          event_type: string;
          operator_alert_required?: boolean;
          payload_hmac: string;
          processed_at?: string | null;
          provider_created_at: string;
          received_at: string;
          safe_failure_code?: string | null;
          status?: string;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<
          Database["private"]["Tables"]["stripe_events"]["Insert"]
        >;
        Relationships: [];
      };
      stripe_reversal_tombstones: {
        Row: {
          binding_id: string;
          processed_at: string;
          provider_created_at: string;
          source_event_id: string;
          stripe_charge_id: string;
          stripe_payment_intent_id: string;
          terminal_state: string;
        };
        Insert: Database["private"]["Tables"]["stripe_reversal_tombstones"]["Row"];
        Update: Partial<
          Database["private"]["Tables"]["stripe_reversal_tombstones"]["Row"]
        >;
        Relationships: [];
      };
      entitlements: {
        Row: {
          created_at: string;
          ends_at: string | null;
          essay_limit: number;
          id: string;
          kind: string;
          season: string;
          starts_at: string;
          status: string;
          stripe_checkout_session_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ends_at?: string | null;
          essay_limit: number;
          id?: string;
          kind: string;
          season: string;
          starts_at?: string;
          status?: string;
          stripe_checkout_session_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<
          Database["private"]["Tables"]["entitlements"]["Insert"]
        >;
        Relationships: [];
      };
      essay_allowance_transactions: {
        Row: {
          created_at: string;
          entitlement_id: string;
          essay_id: string;
          id: string;
          idempotency_key_hmac: string;
          request_hmac: string;
          season: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entitlement_id: string;
          essay_id: string;
          id?: string;
          idempotency_key_hmac: string;
          request_hmac: string;
          season: string;
          user_id: string;
        };
        Update: Partial<
          Database["private"]["Tables"]["essay_allowance_transactions"]["Insert"]
        >;
        Relationships: [];
      };
      interview_questions: {
        Row: {
          coverage_key: string;
          position: number;
          prompt: string;
          question_key: string;
        };
        Insert: {
          coverage_key: string;
          position: number;
          prompt: string;
          question_key: string;
        };
        Update: {
          coverage_key?: string;
          position?: number;
          prompt?: string;
          question_key?: string;
        };
        Relationships: [];
      };
      schools: {
        Row: {
          canonical_name: string;
          created_at: string;
          id: string;
          normalized_domain: string;
          official_domain: string;
          status: string;
          updated_at: string;
          verification_source_url: string;
          verified_at: string;
          verifier_id: string;
        };
        Insert: {
          canonical_name: string;
          created_at?: string;
          id?: string;
          official_domain: string;
          status?: string;
          updated_at?: string;
          verification_source_url: string;
          verified_at: string;
          verifier_id: string;
        };
        Update: {
          canonical_name?: string;
          created_at?: string;
          id?: string;
          official_domain?: string;
          status?: string;
          updated_at?: string;
          verification_source_url?: string;
          verified_at?: string;
          verifier_id?: string;
        };
        Relationships: [];
      };
      usage_reservations: {
        Row: {
          budget_month_start: string;
          created_at: string;
          estimated_cost_cents: number;
          expires_at: string;
          final_cost_cents: number | null;
          final_units: number | null;
          finalized_at: string | null;
          ip_hmac: string;
          operation_id: string;
          quota_window_end: string;
          quota_window_start: string;
          released_at: string | null;
          reserved_units: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          budget_month_start: string;
          created_at?: string;
          estimated_cost_cents: number;
          expires_at: string;
          final_cost_cents?: number | null;
          final_units?: number | null;
          finalized_at?: string | null;
          ip_hmac: string;
          operation_id: string;
          quota_window_end: string;
          quota_window_start: string;
          released_at?: string | null;
          reserved_units?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          budget_month_start?: string;
          created_at?: string;
          estimated_cost_cents?: number;
          expires_at?: string;
          final_cost_cents?: number | null;
          final_units?: number | null;
          finalized_at?: string | null;
          ip_hmac?: string;
          operation_id?: string;
          quota_window_end?: string;
          quota_window_start?: string;
          released_at?: string | null;
          reserved_units?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_reservations_operation_owner_fkey";
            columns: ["user_id", "operation_id"];
            isOneToOne: false;
            referencedRelation: "ai_operations";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      commit_stripe_event: {
        Args: {
          requested_action: string;
          requested_alert_operator: boolean;
          requested_amount_cents: number | null;
          requested_binding_id: string | null;
          requested_charge_id: string | null;
          requested_currency: string | null;
          requested_customer_id: string | null;
          requested_event_created_at: string;
          requested_event_id: string;
          requested_event_type: string;
          requested_livemode: boolean;
          requested_mode: string | null;
          requested_now: string;
          requested_paid_essay_limit: number;
          requested_payload_hmac: string;
          requested_payment_intent_id: string | null;
          requested_price_id: string | null;
          requested_safe_failure_code: string | null;
          requested_season: string | null;
          requested_session_id: string | null;
          requested_user_binding_hmac: string | null;
        };
        Returns: string;
      };
      finalize_checkout_session: {
        Args: {
          requested_at?: string;
          requested_binding_id: string;
          requested_checkout_url: string;
          requested_expires_at: string;
          requested_stripe_customer_id: string | null;
          requested_stripe_session_id: string;
        };
        Returns: string;
      };
      reserve_checkout_session: {
        Args: {
          requested_amount_cents: number;
          requested_at?: string;
          requested_binding_id: string;
          requested_currency: string;
          requested_expires_at: string;
          requested_idempotency_key_hmac: string;
          requested_mode: string;
          requested_price_id: string;
          requested_request_hmac: string;
          requested_season: string;
          requested_user_binding_hmac: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      consume_auth_request_limit: {
        Args: {
          requested_at?: string;
          requested_key_hmac: string;
          requested_limit: number;
          requested_scope: string;
        };
        Returns: {
          allowed: boolean;
          limit_value: number;
          remaining: number;
          reset_at: string;
        }[];
      };
      create_story_profile: {
        Args: {
          requested_at?: string;
          requested_extraction: Json;
          requested_session_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      create_school_request: {
        Args: {
          requested_at?: string;
          requested_idempotency_key_hmac: string;
          requested_name: string;
          requested_request_hmac: string;
          requested_url: string | null;
          requested_user_id: string;
        };
        Returns: Json;
      };
      create_essay_workspace: {
        Args: {
          requested_at?: string;
          requested_free_essay_limit: number;
          requested_idempotency_key_hmac: string;
          requested_prompt: string;
          requested_request_hmac: string;
          requested_school_id: string;
          requested_season: string;
          requested_user_id: string;
          requested_word_limit: number;
        };
        Returns: Json;
      };
      get_billing_entitlement: {
        Args: {
          requested_at?: string;
          requested_default_free_limit: number;
          requested_season: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_school_dossier: {
        Args: {
          requested_at?: string;
          requested_draft: Json;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_essay_angles: {
        Args: {
          requested_angles: Json;
          requested_at?: string;
          requested_dossier_id: string;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_regenerate: boolean;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_outline_proposal: {
        Args: {
          requested_angle_id: string;
          requested_at?: string;
          requested_dossier_id: string;
          requested_draft: Json;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_target_revision: number;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_advice_proposal: {
        Args: {
          requested_at?: string;
          requested_draft: Json;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_target_revision: number;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_revision_proposal: {
        Args: {
          requested_at?: string;
          requested_context_hash: string | null;
          requested_cursor_offset: number | null;
          requested_draft: Json;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_kind: string;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_rewrite_instruction: string | null;
          requested_selection_end: number | null;
          requested_selection_start: number | null;
          requested_selection_text_hash: string | null;
          requested_target_revision: number;
          requested_user_id: string;
        };
        Returns: Json;
      };
      commit_reference_draft_proposal: {
        Args: {
          requested_acknowledgment_version: string;
          requested_at?: string;
          requested_draft: Json;
          requested_essay_id: string;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_target_revision: number;
          requested_user_id: string;
        };
        Returns: Json;
      };
      accept_revision_proposal: {
        Args: {
          requested_at?: string;
          requested_essay_id: string;
          requested_expected_current_draft: string;
          requested_expected_revision: number;
          requested_idempotency_key_hmac: string;
          requested_next_draft: string;
          requested_proposal_id: string;
          requested_request_hmac: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      refresh_school_dossier: {
        Args: {
          requested_at?: string;
          requested_draft: Json;
          requested_essay_id: string;
          requested_expected_revision: number;
          requested_final_cost_cents: number;
          requested_input_tokens: number;
          requested_latency_ms: number;
          requested_model_id: string;
          requested_operation_id: string;
          requested_output_tokens: number;
          requested_provider_request_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      delete_essay_workspace: {
        Args: { requested_essay_id: string; requested_user_id: string };
        Returns: boolean;
      };
      get_essay_workspace: {
        Args: { requested_essay_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_essay_angles: {
        Args: {
          requested_essay_id: string;
          requested_operation_id?: string | null;
          requested_user_id: string;
        };
        Returns: Json;
      };
      get_outline_proposal: {
        Args: { requested_proposal_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_advice_proposal: {
        Args: { requested_proposal_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_revision_proposal: {
        Args: {
          requested_kind: string;
          requested_proposal_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      get_reference_draft_proposal: {
        Args: {
          requested_proposal_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      decide_reference_claim: {
        Args: {
          requested_at?: string;
          requested_claim_id: string;
          requested_decision: string;
          requested_essay_id: string;
          requested_idempotency_key_hmac: string;
          requested_request_hmac: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      get_essay_audit_context: {
        Args: { requested_essay_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_essay_audit: {
        Args: { requested_audit_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_student_draft_export: {
        Args: { requested_essay_id: string; requested_user_id: string };
        Returns: Json;
      };
      commit_essay_audit: {
        Args: {
          requested_at?: string;
          requested_audit_id: string;
          requested_essay_id: string;
          requested_essay_revision: number;
          requested_evidence_manifest_version: string;
          requested_expected_draft_text: string;
          requested_idempotency_key_hmac: string;
          requested_issues: Json;
          requested_request_hmac: string;
          requested_similarity: Json;
          requested_status: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      find_proposal_acceptance_replay: {
        Args: {
          requested_idempotency_key_hmac: string;
          requested_request_hmac: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      select_essay_angle: {
        Args: {
          requested_angle_id: string;
          requested_at?: string;
          requested_essay_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      update_essay_angle: {
        Args: {
          requested_angle_id: string;
          requested_at?: string;
          requested_essay_id: string;
          requested_expected_revision: number;
          requested_thesis: string;
          requested_title: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      update_essay_outline: {
        Args: {
          requested_at?: string;
          requested_essay_id: string;
          requested_expected_revision: number;
          requested_outline: Json;
          requested_user_id: string;
        };
        Returns: Json;
      };
      save_essay_draft: {
        Args: {
          requested_accepted_proposal_id: string | null;
          requested_at?: string;
          requested_draft_text: string | null;
          requested_essay_id: string;
          requested_expected_revision: number;
          requested_origin: string;
          requested_outline: Json | null;
          requested_status: string | null;
          requested_user_id: string;
        };
        Returns: Json;
      };
      get_school_dossier: {
        Args: { requested_dossier_id: string; requested_user_id: string };
        Returns: Json;
      };
      get_school_dossier_for_essay: {
        Args: { requested_essay_id: string; requested_user_id: string };
        Returns: Json;
      };
      list_essay_workspaces: {
        Args: {
          requested_after_id: string | null;
          requested_after_updated_at: string | null;
          requested_limit: number;
          requested_user_id: string;
        };
        Returns: { essay: Json; school: Json }[];
      };
      delete_story_fact: {
        Args: { requested_fact_id: string; requested_user_id: string };
        Returns: boolean;
      };
      get_story_facts_for_ai: {
        Args: { requested_user_id: string };
        Returns: Database["public"]["Tables"]["story_facts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "story_facts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      finalize_ai_operation: {
        Args: {
          requested_at?: string;
          requested_final_cost_cents: number;
          requested_http_status: number;
          requested_input_tokens: number | null;
          requested_latency_ms: number;
          requested_model_id: string | null;
          requested_operation_id: string;
          requested_output_tokens: number | null;
          requested_provider_request_id: string | null;
          requested_result_resource_id: string | null;
          requested_result_resource_type: string | null;
          requested_safe_error_code: string | null;
          requested_status: string;
        };
        Returns: boolean;
      };
      record_profile_consent: {
        Args: {
          requested_at?: string;
          requested_birth_year: number;
          requested_privacy_version: string;
          requested_responsible_use_version: string;
          requested_terms_version: string;
          requested_user_id: string;
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      record_interview_answer: {
        Args: {
          requested_answer: string;
          requested_at?: string;
          requested_question_key: string;
          requested_session_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      search_schools: {
        Args: {
          requested_after_id: string | null;
          requested_after_name: string | null;
          requested_limit: number;
          requested_query: string;
        };
        Returns: {
          canonical_name: string;
          id: string;
          official_domain: string;
        }[];
      };
      set_story_fact_suppression: {
        Args: {
          requested_at?: string;
          requested_fact_id: string;
          requested_suppressed: boolean;
          requested_user_id: string;
        };
        Returns: Json;
      };
      set_story_fact_verification: {
        Args: {
          requested_at?: string;
          requested_content_hmac: string;
          requested_decision: string;
          requested_expected_revision: number;
          requested_fact_id: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      release_ai_operation: {
        Args: {
          requested_at?: string;
          requested_http_status: number;
          requested_operation_id: string;
          requested_safe_error_code: string;
        };
        Returns: boolean;
      };
      reserve_ai_operation: {
        Args: {
          requested_at?: string;
          requested_beta_account_cap: number;
          requested_daily_limit: number;
          requested_essay_id: string | null;
          requested_estimated_cost_cents: number;
          requested_idempotency_key_hmac: string;
          requested_ip_hmac: string;
          requested_method: string;
          requested_monthly_budget_cents: number;
          requested_purpose: string;
          requested_request_hmac: string;
          requested_route: string;
          requested_user_id: string;
        };
        Returns: {
          decision: string;
          operation_id: string | null;
          operation_status: string | null;
          original_http_status: number | null;
          reset_at: string;
          result_resource_id: string | null;
          result_resource_type: string | null;
        }[];
      };
      start_ai_operation: {
        Args: { requested_at?: string; requested_operation_id: string };
        Returns: string;
      };
      start_interview_session: {
        Args: { requested_at?: string; requested_user_id: string };
        Returns: Json;
      };
      update_story_fact: {
        Args: {
          requested_at?: string;
          requested_content_hmac: string;
          requested_details: Json;
          requested_expected_revision: number;
          requested_fact_id: string;
          requested_summary: string;
          requested_user_id: string;
        };
        Returns: Json;
      };
      update_story_profile: {
        Args: {
          requested_at?: string;
          requested_excluded_topics: Json | null;
          requested_expected_revision: number;
          requested_profile_id: string;
          requested_user_id: string;
          requested_voice_profile: Json | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      essays: {
        Row: {
          angle_generation_count: number;
          created_at: string;
          dossier_id: string | null;
          draft_text: string;
          id: string;
          outline: Json | null;
          prompt: string;
          revision: number;
          school_id: string;
          selected_angle_id: string | null;
          season: string;
          status: string;
          updated_at: string;
          user_id: string;
          word_limit: number;
        };
        Insert: {
          angle_generation_count?: number;
          created_at?: string;
          dossier_id?: string | null;
          draft_text?: string;
          id?: string;
          outline?: Json | null;
          prompt: string;
          revision?: number;
          school_id: string;
          selected_angle_id?: string | null;
          season: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          word_limit: number;
        };
        Update: Partial<Database["public"]["Tables"]["essays"]["Insert"]>;
        Relationships: [];
      };
      essay_versions: {
        Row: {
          accepted_proposal_id: string | null;
          created_at: string;
          draft_text: string;
          essay_id: string;
          id: string;
          origin: string;
          revision: number;
          user_id: string;
        };
        Insert: {
          accepted_proposal_id?: string | null;
          created_at?: string;
          draft_text: string;
          essay_id: string;
          id?: string;
          origin: string;
          revision: number;
          user_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["essay_versions"]["Insert"]
        >;
        Relationships: [];
      };
      interview_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          question_key: string;
          role: string;
          sequence: number;
          session_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          question_key: string;
          role: string;
          sequence: number;
          session_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          question_key?: string;
          role?: string;
          sequence?: number;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_messages_session_owner_fkey";
            columns: ["user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "interview_sessions";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      interview_sessions: {
        Row: {
          completed_at: string | null;
          coverage: Json;
          created_at: string;
          current_question_key: string | null;
          id: string;
          next_sequence: number;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          coverage?: Json;
          created_at?: string;
          current_question_key?: string | null;
          id?: string;
          next_sequence?: number;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          coverage?: Json;
          created_at?: string;
          current_question_key?: string | null;
          id?: string;
          next_sequence?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          age_confirmed_at: string;
          birth_year: number;
          consented_at: string;
          created_at: string;
          display_name: string | null;
          onboarding_state: string;
          privacy_version: string;
          responsible_use_version: string;
          terms_version: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          age_confirmed_at: string;
          birth_year: number;
          consented_at: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_state?: string;
          privacy_version: string;
          responsible_use_version: string;
          terms_version: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          age_confirmed_at?: string;
          birth_year?: number;
          consented_at?: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_state?: string;
          privacy_version?: string;
          responsible_use_version?: string;
          terms_version?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      school_requests: {
        Row: {
          created_at: string;
          id: string;
          idempotency_key_hmac: string;
          name: string;
          request_hmac: string;
          status: string;
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          idempotency_key_hmac: string;
          name: string;
          request_hmac: string;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          idempotency_key_hmac?: string;
          name?: string;
          request_hmac?: string;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      school_dossiers: {
        Row: {
          created_at: string;
          essay_id: string;
          id: string;
          operation_id: string;
          schema_version: string;
          school_id: string;
          summary: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          essay_id: string;
          id?: string;
          operation_id: string;
          schema_version?: string;
          school_id: string;
          summary: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["school_dossiers"]["Insert"]
        >;
        Relationships: [];
      };
      school_dossier_sources: {
        Row: {
          category: string;
          claim: string;
          created_at: string;
          dossier_id: string;
          id: string;
          normalized_url: string;
          retrieved_at: string;
          supporting_excerpt: string;
          title: string;
          user_id: string;
        };
        Insert: {
          category: string;
          claim: string;
          created_at?: string;
          dossier_id: string;
          id?: string;
          normalized_url: string;
          retrieved_at: string;
          supporting_excerpt: string;
          title: string;
          user_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["school_dossier_sources"]["Insert"]
        >;
        Relationships: [];
      };
      story_fact_sources: {
        Row: {
          created_at: string;
          fact_id: string;
          message_id: string;
          profile_id: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          fact_id: string;
          message_id: string;
          profile_id: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          fact_id?: string;
          message_id?: string;
          profile_id?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      story_facts: {
        Row: {
          category: string;
          content_hmac: string;
          created_at: string;
          details: Json;
          id: string;
          profile_id: string;
          revision: number;
          summary: string;
          suppressed_at: string | null;
          updated_at: string;
          user_id: string;
          verification_status: string;
          verified_at: string | null;
        };
        Insert: {
          category: string;
          content_hmac: string;
          created_at?: string;
          details: Json;
          id?: string;
          profile_id: string;
          revision?: number;
          summary: string;
          suppressed_at?: string | null;
          updated_at?: string;
          user_id: string;
          verification_status?: string;
          verified_at?: string | null;
        };
        Update: {
          category?: string;
          content_hmac?: string;
          created_at?: string;
          details?: Json;
          id?: string;
          profile_id?: string;
          revision?: number;
          summary?: string;
          suppressed_at?: string | null;
          updated_at?: string;
          user_id?: string;
          verification_status?: string;
          verified_at?: string | null;
        };
        Relationships: [];
      };
      story_profiles: {
        Row: {
          created_at: string;
          excluded_topics: Json;
          id: string;
          revision: number;
          source_session_id: string;
          status: string;
          updated_at: string;
          user_id: string;
          version: number;
          voice_profile: Json;
        };
        Insert: {
          created_at?: string;
          excluded_topics?: Json;
          id?: string;
          revision?: number;
          source_session_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          version: number;
          voice_profile: Json;
        };
        Update: {
          created_at?: string;
          excluded_topics?: Json;
          id?: string;
          revision?: number;
          source_session_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
          voice_profile?: Json;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
